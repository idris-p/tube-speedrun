const runtimeAudit = process.argv.includes("--runtime");
const { connectionSeeds, stationSeeds } = runtimeAudit
  ? await importRuntimeNetwork()
  : await import("../src/data/network.generated.ts");

async function importRuntimeNetwork() {
  const { networkData } = await import("../src/data/network.ts");
  return { connectionSeeds: networkData.connections, stationSeeds: networkData.stations };
}

const DIRECTIONS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const stationById = new Map(stationSeeds.map((station) => [station.id, station]));
const metrics = connectionSeeds.map(auditConnection).sort((a, b) => b.score - a.score);
const branchMismatches = auditBranches();
const totalTurns = metrics.reduce((sum, item) => sum + item.turns, 0);
const complexPlayablePaths = metrics.filter(
  (item) => item.line !== "walk" && item.line !== "waterloo-city" && item.turns > 1,
);
const shortZigZags = metrics.reduce((sum, item) => sum + item.shortZigZags, 0);
const excessivePaths = metrics.filter((item) => item.line !== "waterloo-city" && item.excess > 2);

console.log(`Dataset: ${runtimeAudit ? "runtime" : "generated"}`);
console.log(`Connections: ${connectionSeeds.length}`);
console.log(`Total direction changes: ${totalTurns}`);
console.log(`Playable paths with more than one direction change: ${complexPlayablePaths.length}`);
console.log(`Hump signatures: ${metrics.reduce((sum, item) => sum + item.humps, 0)}`);
console.log(`Short zig-zags: ${shortZigZags}`);
console.log(`Paths with excess length: ${excessivePaths.length}`);
console.log(`Branch exits over 45 degrees from destination: ${branchMismatches.length}`);
console.log("\nWorst paths:");
for (const item of metrics.slice(0, 30)) {
  console.log(
    `${item.id} score=${item.score.toFixed(1)} length=${item.length} direct=${item.direct} excess=${item.excess} turns=${item.turns} humps=${item.humps} runs=${item.runs.map((run, index) => `${run}x${item.runLengths[index]}`).join(",")}`,
  );
}

console.log("\nMisleading branch exits:");
for (const item of branchMismatches.slice(0, 30)) {
  console.log(`${item.station} ${item.line} -> ${item.target}: exit=${item.exit} overall=${item.overall} mismatch=${item.mismatch}`);
}

const failed = runtimeAudit
  ? metrics.some((item) => item.humps > 0) || branchMismatches.length > 0
  : metrics.some((item) => item.humps > 0) ||
    shortZigZags > 0 ||
    excessivePaths.length > 0 ||
    branchMismatches.length > 0;
if (failed) {
  process.exitCode = 1;
}

function auditConnection(connection) {
  const directions = connection.path.slice(1).map((point, index) => directionIndex(connection.path[index], point));
  const runs = directions.filter((direction, index) => index === 0 || direction !== directions[index - 1]);
  const runLengths = [];
  for (const direction of directions) {
    if (runLengths.length === 0 || direction !== runs[runLengths.length - 1]) runLengths.push(1);
    else runLengths[runLengths.length - 1] += 1;
  }
  const turns = runs.slice(1).filter((direction, index) => direction !== runs[index]).length;
  const humps = countHumps(runs);
  const shortZigZags = countShortZigZags(runs, runLengths);
  const start = connection.path[0];
  const end = connection.path.at(-1);
  const direct = gridDistance(start, end);
  const length = connection.path.length - 1;
  const excess = length - direct;
  return {
    id: `${connection.line}:${stationById.get(connection.from)?.name}:${stationById.get(connection.to)?.name}`,
    line: connection.line,
    length,
    direct,
    excess,
    turns,
    humps,
    shortZigZags,
    runs,
    runLengths,
    score: humps * 20 + shortZigZags * 10 + excess * 2 + turns,
  };
}

function auditBranches() {
  const byStationAndLine = new Map();
  for (const connection of connectionSeeds) {
    for (const stationId of [connection.from, connection.to]) {
      const key = `${stationId}:${connection.line}`;
      const items = byStationAndLine.get(key) ?? [];
      items.push({ connection, stationId });
      byStationAndLine.set(key, items);
    }
  }

  const mismatches = [];
  for (const [key, items] of byStationAndLine) {
    if (items.length < 3 || key.endsWith(":walk")) continue;
    for (const { connection, stationId } of items) {
      const reverse = connection.to === stationId;
      const path = reverse ? [...connection.path].reverse() : connection.path;
      const exit = directionIndex(path[0], path[1]);
      const overall = nearestDirection(path[0], path.at(-1));
      const mismatch = turnAmount(exit, overall);
      if (mismatch > 1) {
        const targetId = connection.from === stationId ? connection.to : connection.from;
        mismatches.push({
          station: stationById.get(stationId)?.name,
          target: stationById.get(targetId)?.name,
          line: connection.line,
          exit,
          overall,
          mismatch,
        });
      }
    }
  }
  return mismatches.sort((a, b) => b.mismatch - a.mismatch);
}

function countHumps(runs) {
  let count = 0;
  for (let index = 0; index + 4 < runs.length; index += 1) {
    const [a, b, c, d, e] = runs.slice(index, index + 5);
    if (a === c && c === e && turnAmount(a, b) === 1 && turnAmount(a, d) === 1) count += 1;
  }
  return count;
}

function countShortZigZags(runs, runLengths) {
  let count = 0;
  for (let index = 0; index + 2 < runs.length; index += 1) {
    const [a, b, c] = runs.slice(index, index + 3);
    if (a === c && turnAmount(a, b) === 1 && runLengths[index + 1] <= 2) count += 1;
  }
  return count;
}

function directionIndex(from, to) {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  return DIRECTIONS.findIndex(([x, y]) => x === dx && y === dy);
}

function nearestDirection(from, to) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  return Math.round(((angle / Math.PI) * 4 + 8) % 8) % 8;
}

function turnAmount(a, b) {
  const difference = Math.abs(a - b);
  return Math.min(difference, 8 - difference);
}

function gridDistance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
