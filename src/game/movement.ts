import { createConnectionId } from "../data/network";
import type { Connection, GridPoint, NetworkData, Point, Station } from "../data/types";
import type { GameState } from "./GameState";
import { isCountedLineChange } from "./journey";

export type MovementDirection =
  | "north"
  | "northeast"
  | "east"
  | "southeast"
  | "south"
  | "southwest"
  | "west"
  | "northwest";

export const MOVEMENT_DIRECTIONS: readonly MovementDirection[] = [
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
  "north",
  "northeast",
];

export const MOVEMENT_DIRECTION_ANGLES: Record<MovementDirection, number> = {
  east: 0,
  southeast: 45,
  south: 90,
  southwest: 135,
  west: 180,
  northwest: 225,
  north: 270,
  northeast: 315,
};

export type MoveResult = {
  state: GameState;
  moved: boolean;
  targetStationId: string | null;
  reason: "completed" | "no-neighbour" | "direction-mismatch" | null;
};

export function getStation(network: NetworkData, stationId: string): Station {
  const station = network.stations.find((candidate) => candidate.id === stationId);
  if (!station) {
    throw new Error(`Unknown station: ${stationId}`);
  }
  return station;
}

export function getConnectionBetween(network: NetworkData, from: string, to: string, line = ""): Connection | undefined {
  return network.connections.find(
    (connection) =>
      (line === "" || connection.line === line) &&
      ((connection.from === from && connection.to === to) || (connection.from === to && connection.to === from)),
  );
}

export function getLineConnections(network: NetworkData, stationId: string, line: string): Connection[] {
  return network.connections.filter(
    (connection) =>
      connection.line === line &&
      (connection.from === stationId || (!connection.oneWay && connection.to === stationId)),
  );
}

export function getLineNeighbours(network: NetworkData, stationId: string, line: string): Station[] {
  const neighbourIds = getLineConnections(network, stationId, line).map((connection) =>
    connection.from === stationId ? connection.to : connection.from,
  );

  return neighbourIds.map((id) => getStation(network, id));
}

export function angleBetweenPoints(from: Point, to: Point): number {
  const degrees = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  return normalizeAngle(degrees);
}

export function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

export function angleDifferenceDegrees(a: number, b: number): number {
  const difference = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(difference, 360 - difference);
}

export function snapAngleToDirection(angle: number): MovementDirection {
  const directionIndex = Math.round(normalizeAngle(angle) / 45) % MOVEMENT_DIRECTIONS.length;
  return MOVEMENT_DIRECTIONS[directionIndex];
}

export function directionFromVelocity(
  dx: number,
  dy: number,
  fallbackDirection: MovementDirection,
  minimumDistance = 0.01,
): MovementDirection {
  if (Math.hypot(dx, dy) < minimumDistance) {
    return fallbackDirection;
  }

  return snapAngleToDirection(angleBetweenPoints({ x: 0, y: 0 }, { x: dx, y: dy }));
}

export function getDirectionAngle(direction: MovementDirection): number {
  return MOVEMENT_DIRECTION_ANGLES[direction];
}

export function gridStepToDirection(from: GridPoint, to: GridPoint): MovementDirection | null {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);

  if (dx === 0 && dy === -1) {
    return "north";
  }
  if (dx === 1 && dy === -1) {
    return "northeast";
  }
  if (dx === 1 && dy === 0) {
    return "east";
  }
  if (dx === 1 && dy === 1) {
    return "southeast";
  }
  if (dx === 0 && dy === 1) {
    return "south";
  }
  if (dx === -1 && dy === 1) {
    return "southwest";
  }
  if (dx === -1 && dy === 0) {
    return "west";
  }
  if (dx === -1 && dy === -1) {
    return "northwest";
  }

  return null;
}

export function getConnectionPathFrom(connection: Connection, stationId: string): GridPoint[] | null {
  if (connection.from === stationId) {
    return connection.path;
  }

  if (!connection.oneWay && connection.to === stationId) {
    return [...connection.path].reverse();
  }

  return null;
}

export function getConnectionFirstStepDirection(connection: Connection, stationId: string): MovementDirection | null {
  const override = connection.from === stationId
    ? connection.directionOverrides?.from
    : connection.to === stationId
      ? connection.directionOverrides?.to
      : undefined;
  if (override) {
    return gridStepToDirection({ x: 0, y: 0 }, override);
  }

  const path = getConnectionPathFrom(connection, stationId);
  if (!path || path.length < 2) {
    return null;
  }

  return gridStepToDirection(path[0], path[1]);
}

export function findDirectionalNeighbour(
  network: NetworkData,
  stationId: string,
  line: string,
  intendedDirection: MovementDirection,
): Station | null {
  for (const connection of getLineConnections(network, stationId, line)) {
    if (getConnectionFirstStepDirection(connection, stationId) !== intendedDirection) {
      continue;
    }

    return getStation(network, connection.from === stationId ? connection.to : connection.from);
  }

  return null;
}

export function attemptMove(
  state: GameState,
  network: NetworkData,
  intendedAngle: number,
  now: number,
): MoveResult {
  return attemptMoveInDirection(state, network, snapAngleToDirection(intendedAngle), now);
}

export function attemptMoveInDirection(
  state: GameState,
  network: NetworkData,
  intendedDirection: MovementDirection,
  now: number,
): MoveResult {
  if (state.completed) {
    return { state, moved: false, targetStationId: null, reason: "completed" };
  }

  const connections = getLineConnections(network, state.currentStationId, state.selectedLineId);
  if (connections.length === 0) {
    return {
      state: { ...state, rejectedMoveAt: now },
      moved: false,
      targetStationId: null,
      reason: "no-neighbour",
    };
  }

  const target = findDirectionalNeighbour(network, state.currentStationId, state.selectedLineId, intendedDirection);

  if (!target) {
    return {
      state: { ...state, rejectedMoveAt: now },
      moved: false,
      targetStationId: null,
      reason: "direction-mismatch",
    };
  }

  const connectionId = createConnectionId(state.selectedLineId, state.currentStationId, target.id);
  const revealedConnections = new Set(state.revealedConnections);
  revealedConnections.add(connectionId);

  const completed = target.id === state.destinationStationId;
  const changedLineOnDeparture =
    state.enteredStationLineId !== null &&
    isCountedLineChange(state.enteredStationLineId, state.selectedLineId);

  return {
    state: {
      ...state,
      currentStationId: target.id,
      enteredStationLineId: state.selectedLineId,
      revealedConnections,
      journeyLegs: [
        ...state.journeyLegs,
        {
          fromStationId: state.currentStationId,
          toStationId: target.id,
          lineId: state.selectedLineId,
        },
      ],
      moveCount: state.moveCount + 1,
      changeCount: state.changeCount + (changedLineOnDeparture ? 1 : 0),
      completed,
      endTime: completed ? now : state.endTime,
      rejectedMoveAt: null,
    },
    moved: true,
    targetStationId: target.id,
    reason: null,
  };
}
