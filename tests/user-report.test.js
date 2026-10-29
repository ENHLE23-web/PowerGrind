const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

class FakeElement {
  constructor() {
    this.attributes = {};
    this.children = [];
    this.disabled = false;
    this.hidden = false;
    this.listeners = {};
    this.style = {};
    this.textContent = "";
    this.value = "";
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  appendChild(child) {
    this.children.push(child);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  replaceChildren() {
    this.children = [];
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }
}

function loadReportForm() {
  const ids = [
    "reportForm",
    "electricalIssue",
    "issueType",
    "outageTypeValidation",
    "photoPreview",
    "residentCameraEmpty",
    "takeResidentPhoto",
    "removeResidentPhoto",
    "photoAnalysisState",
    "reportToast",
    "locationStatus",
    "locationText",
    "captureLocationButton",
    "description",
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement()]));
  elements.outageTypeValidation.textContent = "Please select an outage type that matches the affected area.";
  const submitButton = new FakeElement();
  elements.reportForm.querySelector = function () {
    return submitButton;
  };
  const createdReports = [];
  const context = {
    alert: function () {},
    console,
    document: {
      createElement: function () { return new FakeElement(); },
      getElementById: function (id) { return elements[id] || null; },
    },
    navigator: {
      geolocation: {
        getCurrentPosition: function (success) {
          success({ coords: { latitude: -25.7, longitude: 28.2 } });
        },
      },
    },
    sessionStorage: { setItem: function () {} },
    setTimeout: function (callback) { callback(); },
    URL: { revokeObjectURL: function () {} },
    window: {
      addEventListener: function () {},
      location: { href: "" },
      PowerGridCamera: { open: async function () { return null; } },
      SecureReportMedia: {},
      SecureReportStore: {
        analyzeOutageImage: async function () { return null; },
        createReport: function (input) {
          createdReports.push(input);
          return { matched: false, report: { id: "SR-TEST" }, incident: { id: "INC-TEST" } };
        },
      },
    },
  };
  const source = fs.readFileSync(path.join(__dirname, "..", "js", "user-report.js"), "utf8");
  vm.runInNewContext(source, context);
  return { createdReports, elements };
}

test("resident outage types follow the selected affected scope", function () {
  const { elements } = loadReportForm();
  const scope = elements.issueType;
  const outage = elements.electricalIssue;

  assert.equal(outage.disabled, true);
  assert.deepEqual(outage.children.map((option) => option.textContent), ["Select an outage type"]);

  scope.value = "household";
  scope.listeners.change();
  assert.equal(outage.disabled, false);
  assert.deepEqual(outage.children.map((option) => option.textContent), [
    "Select an outage type",
    "Power outage",
    "Prepaid meter problem",
    "Electrical box / equipment damage",
    "Sparking or electrical hazard",
    "Other electrical issue",
  ]);

  outage.value = "Power outage";
  scope.value = "public";
  scope.listeners.change();
  assert.equal(outage.value, "Power outage");

  scope.value = "household";
  scope.listeners.change();
  outage.value = "Prepaid meter problem";
  scope.value = "public";
  scope.listeners.change();
  assert.equal(outage.value, "");
  assert.deepEqual(outage.children.map((option) => option.textContent), [
    "Select an outage type",
    "Power outage",
    "Streetlight not working",
    "Damaged power line",
    "Transformer / substation fault",
    "Electrical box / equipment damage",
    "Sparking or electrical hazard",
    "Other electrical issue",
  ]);
});

test("forced incompatible scope and outage type cannot be submitted", async function () {
  const invalidPairs = [
    ["household", "Streetlight not working"],
    ["household", "Damaged power line"],
    ["household", "Transformer / substation fault"],
    ["public", "Prepaid meter problem"],
  ];

  for (const [scope, outageType] of invalidPairs) {
    const { createdReports, elements } = loadReportForm();
    elements.issueType.value = scope;
    elements.issueType.listeners.change();
    elements.electricalIssue.value = outageType;
    elements.description.value = "Forced invalid combination.";

    await elements.reportForm.listeners.submit({ preventDefault: function () {} });

    assert.equal(createdReports.length, 0);
    assert.equal(elements.outageTypeValidation.hidden, false);
    assert.equal(
      elements.outageTypeValidation.textContent,
      "Please select an outage type that matches the affected area.",
    );
    assert.equal(elements.electricalIssue.attributes["aria-invalid"], "true");
  }
});

test("valid submission preserves the legacy stored scope value", async function () {
  const { createdReports, elements } = loadReportForm();
  elements.issueType.value = "household";
  elements.issueType.listeners.change();
  elements.electricalIssue.value = "Prepaid meter problem";
  elements.description.value = "Meter has stopped supplying the property.";

  await elements.reportForm.listeners.submit({ preventDefault: function () {} });

  assert.equal(createdReports.length, 1);
  assert.equal(createdReports[0].issueType, "Household issue");
  assert.equal(createdReports[0].outageType, "Prepaid meter problem");
});
