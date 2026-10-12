import test from "node:test";
import assert from "node:assert/strict";
import {
  applyInstallationNotificationTimestamps,
  buildInstallationNotificationEvents,
} from "./installationNotifications.js";

const fixedNow = () => new Date("2026-10-12T12:00:00.000Z");

test("records installation start only when the installation stage becomes active", () => {
  const stages = applyInstallationNotificationTimestamps(
    [{ key: "installation", name: "Installation", status: "pending" }],
    [
      { key: "installation_scheduling", name: "Installation Scheduling", status: "in_progress" },
      { key: "installation_agreement", name: "Installation Agreement", status: "in_progress" },
      { key: "installation", name: "Installation", status: "in_progress" },
    ],
    fixedNow
  );

  assert.equal(stages[0].installationStartedAt, undefined);
  assert.equal(stages[1].installationStartedAt, undefined);
  assert.equal(stages[2].installationStartedAt.toISOString(), "2026-10-12T12:00:00.000Z");
  assert.equal(stages[2].installationCompletedAt, null);
});

test("preserves timestamps on repeated updates and records completion once", () => {
  const startedAt = new Date("2026-10-11T12:00:00.000Z");
  const previousStages = [{
    key: "installation",
    name: "Installation",
    status: "in_progress",
    installationStartedAt: startedAt,
  }];

  const unchanged = applyInstallationNotificationTimestamps(previousStages, previousStages, fixedNow);
  assert.equal(unchanged[0].installationStartedAt, startedAt);
  assert.equal(unchanged[0].installationCompletedAt, null);

  const completed = applyInstallationNotificationTimestamps(previousStages, [{
    ...previousStages[0],
    status: "done",
    completed: true,
  }], fixedNow);
  assert.equal(completed[0].installationStartedAt, startedAt);
  assert.equal(completed[0].installationCompletedAt.toISOString(), "2026-10-12T12:00:00.000Z");

  const repeatedCompletion = applyInstallationNotificationTimestamps(completed, completed, () => {
    throw new Error("Repeated updates must not create another event timestamp");
  });
  assert.equal(repeatedCompletion[0].installationCompletedAt, completed[0].installationCompletedAt);
});

test("does not create another installation-start event after a status reversal", () => {
  const startedAt = new Date("2026-10-11T12:00:00.000Z");
  const pausedStages = [{
    key: "installation",
    name: "Installation",
    status: "pending",
    installationStartedAt: startedAt,
  }];

  const resumedStages = applyInstallationNotificationTimestamps(pausedStages, [{
    ...pausedStages[0],
    status: "in_progress",
  }], () => {
    throw new Error("Resuming installation must not create another start event");
  });

  assert.equal(resumedStages[0].installationStartedAt, startedAt);
});

test("backfills one-time timestamps when an installation stage is already active", () => {
  const stages = applyInstallationNotificationTimestamps(
    [{ key: "installation", name: "Installation", status: "in_progress" }],
    [{ key: "installation", name: "Installation", status: "in_progress" }],
    fixedNow
  );

  assert.equal(stages[0].installationStartedAt.toISOString(), "2026-10-12T12:00:00.000Z");
  assert.equal(stages[0].installationCompletedAt, null);
});

test("creates the up-next event only after every preceding stage and sub-stage is complete", () => {
  const stages = [
    { key: "cutting", status: "done", completed: true, subStages: [{ status: "done", completed: true }] },
    { key: "fabrication", status: "done", completed: true },
    { key: "installation_scheduling", status: "done", completed: true },
    { key: "installation", name: "Installation", status: "in_progress", completed: false },
  ];

  const events = buildInstallationNotificationEvents(stages, { itemIndex: 1, productName: "Window" });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "installation_up_next");
  assert.equal(events[0].message, "Your ACGC order is up next for installation. Our team will begin the installation stage soon. Please stay tuned for updates.");
  assert.equal(events[0].eventKey, "installation_up_next:installation:item:1");

  const incompletePrecedingStage = buildInstallationNotificationEvents([
    { ...stages[0], subStages: [{ status: "pending", completed: false }] },
    ...stages.slice(1),
  ]);
  assert.deepEqual(incompletePrecedingStage, []);
});

test("creates completion only for a genuinely completed installation stage", () => {
  const inProgressEvents = buildInstallationNotificationEvents([
    { key: "cutting", status: "done", completed: true },
    { key: "installation", name: "Installation", status: "in_progress", completed: false },
  ]);
  assert.equal(inProgressEvents.some((event) => event.type === "installation_completed"), false);

  const completedEvents = buildInstallationNotificationEvents([
    { key: "cutting", status: "done", completed: true },
    { key: "installation", name: "Installation", status: "done", completed: true, date: "2026-10-12T12:00:00.000Z" },
  ]);
  assert.equal(completedEvents.length, 1);
  assert.equal(completedEvents[0].type, "installation_completed");
  assert.equal(completedEvents[0].completedAt, "2026-10-12T12:00:00.000Z");
});

test("does not treat scheduling or agreement stages as Installation", () => {
  assert.deepEqual(buildInstallationNotificationEvents([
    { key: "cutting", status: "done", completed: true },
    { key: "installation_scheduling", status: "done", completed: true },
    { key: "installation_agreement", status: "done", completed: true },
    { key: "installation_preparation", name: "Installation Preparation", status: "done", completed: true },
  ]), []);
});

test("does not announce Installation Coming Up while Installation is delayed or on hold", () => {
  for (const status of ["delayed", "on_hold"]) {
    const events = buildInstallationNotificationEvents([
      { key: "fabrication", status: "done", completed: true },
      { key: "installation", name: "Installation", status, completed: false },
    ]);
    assert.deepEqual(events, []);
  }
});