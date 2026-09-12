import { createGroupDefinition, defaultState } from "../../dmicher-master-screen/scripts/model.js";

/** The four-state example is test data, never an implicit live-scene template. */
export function sampleGroupDefinition() {
  const states = [defaultState("Спокойствие", "calm"), defaultState("Напряжение", "tension"),
    defaultState("Тревога", "alarm"), defaultState("Остановка", "stop")];
  return { ...createGroupDefinition({ groupId: "main", groupName: "Основная группа", state: states[0] }), states };
}
