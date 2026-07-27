import { LINE_BY_ID } from "./lines";
import type { LineId, NetworkData } from "./types";

const ALLOWED_SHORT_ZIG_ZAG_CONNECTIONS = new Set([
  "bakerloo:paddington:warwick-avenue",
  "metropolitan:baker-street:finchley-road",
  "northern:euston:warren-street",
  "victoria:finsbury-park:highbury-and-islington",
]);

const ALLOWED_SCHEMATIC_DETOUR_CONNECTIONS = new Set([
  "bakerloo:edgware-road-bakerloo:paddington",
  "circle:aldgate:liverpool-street",
  "circle:aldgate:tower-hill",
  "district:aldgate-east:tower-hill",
  "central:gants-hill:newbury-park",
  "central:grange-hill:hainault",
  "jubilee:canning-town:north-greenwich",
  "metropolitan:aldgate:liverpool-street",
  "piccadilly:hatton-cross:heathrow-terminal-4",
  "piccadilly:heathrow-terminal-2-and-3:heathrow-terminal-4",
  "victoria:highbury-and-islington:king-s-cross-st-pancras",
]);

const ALLOWED_SHARP_TURN_CONNECTIONS = new Set([
  "bakerloo:edgware-road-bakerloo:paddington",
  "bakerloo:baker-street:marylebone",
  "central:gants-hill:newbury-park",
  "central:grange-hill:hainault",
  "elizabeth:acton-main-line:ealing-broadway",
  "elizabeth:ealing-broadway:west-ealing",
  "elizabeth:farringdon:liverpool-street",
  "jubilee:finchley-road:swiss-cottage",
  "jubilee:finchley-road:west-hampstead",
  "jubilee:kingsbury:wembley-park",
  "jubilee:neasden:wembley-park",
  "piccadilly:hatton-cross:heathrow-terminal-4",
  "piccadilly:heathrow-terminal-2-and-3:heathrow-terminal-4",
]);

const ALLOWED_SHARP_THROUGH_STATIONS = new Set([
  "baker-street:jubilee",
]);

export function validateNetworkData(network: NetworkData): string[] {
  const errors: string[] = [];
  const stationIds = new Set<string>();
  const occupiedCells = new Map<string, string>();
  const connectionIds = new Set<string>();
  const actualLinesByStation = new Map<string, Set<LineId>>();
  const exitsByStationAndLine = new Map<
    string,
    Array<{ connectionId: string; direction: number; overallDirection: number }>
  >();
  const walkPairs = new Set(
    network.connections
      .filter((connection) => connection.line === "walk")
      .map((connection) => stationPairKey(connection.from, connection.to)),
  );

  for (const station of network.stations) {
    if (stationIds.has(station.id)) {
      errors.push(`Duplicate station id: ${station.id}`);
    }
    stationIds.add(station.id);

    if (station.name.toLowerCase().includes("tram")) {
      errors.push(`Station appears to reference trams: ${station.name}`);
    }

    if (!Number.isFinite(station.labelOffset.x) || !Number.isFinite(station.labelOffset.y)) {
      errors.push(`Station ${station.id} has an invalid label offset`);
    }

    const cellKey = `${station.x},${station.y}`;
    const occupiedBy = occupiedCells.get(cellKey);
    if (occupiedBy) {
      errors.push(`Stations ${occupiedBy} and ${station.id} share grid cell ${cellKey}`);
    }
    occupiedCells.set(cellKey, station.id);
  }

  for (let firstIndex = 0; firstIndex < network.stations.length; firstIndex += 1) {
    const first = network.stations[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < network.stations.length; secondIndex += 1) {
      const second = network.stations[secondIndex];
      const dx = Math.abs(first.x - second.x);
      const dy = Math.abs(first.y - second.y);
      if (dx > 1 || dy > 1 || walkPairs.has(stationPairKey(first.id, second.id))) {
        continue;
      }
      errors.push(`Stations ${first.id} and ${second.id} are in adjacent grid cells`);
    }
  }

  for (const connection of network.connections) {
    if (connectionIds.has(connection.id)) {
      errors.push(`Duplicate connection id: ${connection.id}`);
    }
    connectionIds.add(connection.id);

    if (!LINE_BY_ID[connection.line]) {
      errors.push(`Unknown line id: ${connection.line}`);
    }

    if (!stationIds.has(connection.from)) {
      errors.push(`Connection ${connection.id} has missing from station ${connection.from}`);
    }

    if (!stationIds.has(connection.to)) {
      errors.push(`Connection ${connection.id} has missing to station ${connection.to}`);
    }

    const fromStation = network.stations.find((station) => station.id === connection.from);
    const toStation = network.stations.find((station) => station.id === connection.to);
    const firstPathPoint = connection.path[0];
    const lastPathPoint = connection.path[connection.path.length - 1];

    if (connection.path.length < 2) {
      errors.push(`Connection ${connection.id} path must include at least two grid cells`);
    }

    if (
      fromStation &&
      (!firstPathPoint || firstPathPoint.x !== fromStation.x || firstPathPoint.y !== fromStation.y)
    ) {
      errors.push(`Connection ${connection.id} path must start at ${connection.from}`);
    }

    if (toStation && (!lastPathPoint || lastPathPoint.x !== toStation.x || lastPathPoint.y !== toStation.y)) {
      errors.push(`Connection ${connection.id} path must end at ${connection.to}`);
    }

    for (let index = 1; index < connection.path.length; index += 1) {
      const previous = connection.path[index - 1];
      const current = connection.path[index];
      const dx = Math.abs(current.x - previous.x);
      const dy = Math.abs(current.y - previous.y);

      if (dx > 1 || dy > 1 || (dx === 0 && dy === 0)) {
        errors.push(`Connection ${connection.id} has invalid grid step ${index - 1} -> ${index}`);
      }

      if (index < 2) {
        continue;
      }

      const beforePrevious = connection.path[index - 2];
      const previousDirection = getGridDirectionIndex(beforePrevious, previous);
      const currentDirection = getGridDirectionIndex(previous, current);

      if (previousDirection === null || currentDirection === null) {
        continue;
      }

      const turnAmount = getDirectionTurnAmount(previousDirection, currentDirection);
      if (turnAmount > 1 && !ALLOWED_SHARP_TURN_CONNECTIONS.has(connection.id)) {
        errors.push(`Connection ${connection.id} has sharp turn at path point ${index - 1}`);
      }
    }

    const pathDirections = connection.path
      .slice(1)
      .map((point, index) => getGridDirectionIndex(connection.path[index], point))
      .filter((direction): direction is number => direction !== null);
    const directionRuns = pathDirections.filter(
      (direction, index) => index === 0 || direction !== pathDirections[index - 1],
    );
    const directionRunLengths = getDirectionRunLengths(pathDirections);
    if (hasHumpSignature(directionRuns)) {
      errors.push(`Connection ${connection.id} contains an unnecessary hump`);
    }
    if (
      hasShortZigZag(directionRuns, directionRunLengths) &&
      !ALLOWED_SHORT_ZIG_ZAG_CONNECTIONS.has(connection.id)
    ) {
      errors.push(`Connection ${connection.id} contains a short zig-zag`);
    }

    if (firstPathPoint && lastPathPoint) {
      const directLength = Math.max(
        Math.abs(lastPathPoint.x - firstPathPoint.x),
        Math.abs(lastPathPoint.y - firstPathPoint.y),
      );
      const pathLength = connection.path.length - 1;
      if (
        connection.line !== "waterloo-city" &&
        !ALLOWED_SCHEMATIC_DETOUR_CONNECTIONS.has(connection.id) &&
        pathLength - directLength > 2
      ) {
        errors.push(`Connection ${connection.id} has an excessive detour`);
      }
    }

    for (const stationId of [connection.from, connection.to]) {
      const lines = actualLinesByStation.get(stationId) ?? new Set<LineId>();
      lines.add(connection.line);
      actualLinesByStation.set(stationId, lines);

      const isFrom = stationId === connection.from;
      if (connection.oneWay && !isFrom) {
        continue;
      }
      const path = isFrom ? connection.path : [...connection.path].reverse();
      if (path.length >= 2) {
        const override = isFrom
          ? connection.directionOverrides?.from
          : connection.directionOverrides?.to;
        const direction = override
          ? getGridDirectionIndex({ x: 0, y: 0 }, override)
          : getGridDirectionIndex(path[0], path[1]);
        if (direction !== null) {
          const key = `${stationId}:${connection.line}`;
          const exits = exitsByStationAndLine.get(key) ?? [];
          const overallDirection = getNearestGridDirection(path[0], path[path.length - 1]);
          exits.push({ connectionId: connection.id, direction, overallDirection });
          exitsByStationAndLine.set(key, exits);
        }
      }
    }
  }

  for (const [key, exits] of exitsByStationAndLine) {
    const directions = new Map<number, string>();
    for (const exit of exits) {
      const existingConnection = directions.get(exit.direction);
      if (existingConnection) {
        errors.push(
          `Station/line ${key} has duplicate exit direction for ${existingConnection} and ${exit.connectionId}`,
        );
      } else {
        directions.set(exit.direction, exit.connectionId);
      }
    }

    if (!key.endsWith(":walk") && exits.length === 2 && !ALLOWED_SHARP_THROUGH_STATIONS.has(key)) {
      const separation = getDirectionTurnAmount(exits[0].direction, exits[1].direction);
      if (separation < 3) {
        errors.push(`Station/line ${key} makes a sharp through-station turn`);
      }
    }

    if (!key.endsWith(":walk") && exits.length >= 3) {
      for (const exit of exits) {
        if (getDirectionTurnAmount(exit.direction, exit.overallDirection) > 1) {
          errors.push(`Station/line ${key} has misleading branch exit for ${exit.connectionId}`);
        }
      }
    }
  }

  for (const station of network.stations) {
    const declared = [...station.lines].sort();
    const actual = [...(actualLinesByStation.get(station.id) ?? [])].sort();

    if (declared.join(",") !== actual.join(",")) {
      errors.push(`Station ${station.id} declares lines [${declared.join(",")}] but connections imply [${actual.join(",")}]`);
    }
  }

  return errors;
}

function stationPairKey(a: string, b: string): string {
  return [a, b].sort().join(":");
}

function hasHumpSignature(directionRuns: number[]): boolean {
  for (let index = 0; index + 4 < directionRuns.length; index += 1) {
    const [a, b, c, d, e] = directionRuns.slice(index, index + 5);
    if (
      a === c &&
      c === e &&
      getDirectionTurnAmount(a, b) === 1 &&
      getDirectionTurnAmount(a, d) === 1
    ) {
      return true;
    }
  }
  return false;
}

function getDirectionRunLengths(pathDirections: number[]): number[] {
  const lengths: number[] = [];
  let previousDirection: number | undefined;
  for (const direction of pathDirections) {
    if (direction !== previousDirection) {
      lengths.push(1);
    } else {
      lengths[lengths.length - 1] += 1;
    }
    previousDirection = direction;
  }
  return lengths;
}

function hasShortZigZag(directionRuns: number[], runLengths: number[]): boolean {
  for (let index = 0; index + 2 < directionRuns.length; index += 1) {
    const [a, b, c] = directionRuns.slice(index, index + 3);
    if (a === c && getDirectionTurnAmount(a, b) === 1 && runLengths[index + 1] <= 2) {
      return true;
    }
  }
  return false;
}

function getNearestGridDirection(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  return Math.round(((angle / Math.PI) * 4 + 8) % 8) % 8;
}

function getGridDirectionIndex(from: { x: number; y: number }, to: { x: number; y: number }): number | null {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);

  if (dx === 1 && dy === 0) {
    return 0;
  }
  if (dx === 1 && dy === 1) {
    return 1;
  }
  if (dx === 0 && dy === 1) {
    return 2;
  }
  if (dx === -1 && dy === 1) {
    return 3;
  }
  if (dx === -1 && dy === 0) {
    return 4;
  }
  if (dx === -1 && dy === -1) {
    return 5;
  }
  if (dx === 0 && dy === -1) {
    return 6;
  }
  if (dx === 1 && dy === -1) {
    return 7;
  }

  return null;
}

function getDirectionTurnAmount(previousDirection: number, nextDirection: number): number {
  const difference = Math.abs(previousDirection - nextDirection);
  return Math.min(difference, 8 - difference);
}
