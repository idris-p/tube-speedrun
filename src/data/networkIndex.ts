import type { Connection, NetworkData, Station } from "./types";

export type NetworkIndex = {
  readonly stationById: ReadonlyMap<string, Station>;
  readonly connectionById: ReadonlyMap<string, Connection>;
  readonly connectionsByStation: ReadonlyMap<string, readonly Connection[]>;
  readonly outgoingConnectionsByStation: ReadonlyMap<string, readonly Connection[]>;
  readonly neighbourIdsByStation: ReadonlyMap<string, readonly string[]>;
};

const networkIndexCache = new WeakMap<NetworkData, NetworkIndex>();

export function getNetworkIndex(network: NetworkData): NetworkIndex {
  const cached = networkIndexCache.get(network);
  if (cached) {
    return cached;
  }

  const index = createNetworkIndex(network);
  networkIndexCache.set(network, index);
  return index;
}

export function createNetworkIndex(network: NetworkData): NetworkIndex {
  const stationById = new Map(network.stations.map((station) => [station.id, station]));
  const connectionById = new Map(network.connections.map((connection) => [connection.id, connection]));
  const connectionsByStation = new Map<string, Connection[]>();
  const outgoingConnectionsByStation = new Map<string, Connection[]>();
  const neighbourIdsByStation = new Map<string, string[]>();

  for (const station of network.stations) {
    connectionsByStation.set(station.id, []);
    outgoingConnectionsByStation.set(station.id, []);
    neighbourIdsByStation.set(station.id, []);
  }

  for (const connection of network.connections) {
    connectionsByStation.get(connection.from)?.push(connection);
    connectionsByStation.get(connection.to)?.push(connection);
    outgoingConnectionsByStation.get(connection.from)?.push(connection);
    if (!connection.oneWay) {
      outgoingConnectionsByStation.get(connection.to)?.push(connection);
    }

    // Network distance intentionally remains undirected, including one-way gameplay links.
    neighbourIdsByStation.get(connection.from)?.push(connection.to);
    neighbourIdsByStation.get(connection.to)?.push(connection.from);
  }

  return {
    stationById,
    connectionById,
    connectionsByStation,
    outgoingConnectionsByStation,
    neighbourIdsByStation,
  };
}
