import { LINE_BY_ID } from "../data/lines";
import type { NetworkData } from "../data/types";
import type { GameState } from "../game/GameState";
import { getElapsedMilliseconds } from "../game/GameState";
import { createJourneySummary, formatJourneyStationName } from "../game/journey";
import { getLineCyclePreview } from "../game/lineSelection";
import { getStation } from "../game/movement";
import { ROUND_COUNT, type RunResults, type RunState } from "../game/RunState";
import { GRID_CELL_SIZE } from "../rendering/grid";
import { LINE_STROKE_WIDTH } from "../rendering/lineStyles";
import {
  INTERCHANGE_OUTLINE_WIDTH,
  createBarMarker,
  createInterchangeMarker,
} from "../rendering/stationRenderer";
import { createHowToPlayContent } from "./howToPlay";
import { createHudMetric, renderTimeValue } from "./hudMetric";

export type HudCallbacks = {
  onStartRandomSeed: () => void;
  onStartSeed: (seed: string) => void;
  onOpenMap: () => void;
  onFocusMapStation: (stationId: string) => void;
  onReturnToMenu: () => void;
  onPlayAgain: () => void;
  onAdvanceRound: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
};

export type MenuMode = "home" | "how-to-play" | "seed-choice" | "seed-entry";
type SocialLinkId = "github" | "reddit" | "x";
type MapSearchEntry = { label: string; stationId: string };

const SOCIAL_LINKS: { id: SocialLinkId; label: string; href: string }[] = [
  { id: "github", label: "GitHub", href: "https://github.com/idris-p" },
  { id: "reddit", label: "Reddit", href: "https://www.reddit.com/user/idris--p/" },
  { id: "x", label: "X", href: "https://x.com/idris__p" },
];
const SVG_NS = "http://www.w3.org/2000/svg";
const JOURNEY_MARKER_SIZE = 20;

export class Hud {
  readonly mapHost: HTMLDivElement;

  private readonly shell: HTMLElement;
  private readonly statsPanel: HTMLDivElement;
  private readonly timerPanel: HTMLDivElement;
  private readonly timerValue: HTMLSpanElement;
  private readonly roundValue: HTMLSpanElement;
  private readonly moveValue: HTMLSpanElement;
  private readonly changeValue: HTMLSpanElement;
  private readonly stationValue: HTMLSpanElement;
  private readonly destinationValue: HTMLSpanElement;
  private readonly lineIndicator: HTMLDivElement;
  private zoomControls: HTMLDivElement | null = null;
  private readonly overlayButton: HTMLButtonElement;
  private readonly completionOverlay: HTMLDivElement;
  private readonly completionTitle: HTMLHeadingElement;
  private readonly completionMeta: HTMLParagraphElement;
  private readonly completionSeedText: HTMLSpanElement;
  private readonly completionSeedCopyButton: HTMLButtonElement;
  private readonly completionTime: HTMLSpanElement;
  private readonly completionMoves: HTMLSpanElement;
  private readonly completionChanges: HTMLSpanElement;
  private readonly completionStats: HTMLDivElement;
  private readonly completionJourney: HTMLElement;
  private readonly completionJourneyDiagram: HTMLDivElement;
  private readonly completionCloseButton: HTMLButtonElement;
  private readonly completionQuitButton: HTMLButtonElement;
  private readonly dismissedRoundActionButton: HTMLButtonElement;
  private readonly gameplayExitButton: HTMLButtonElement;
  private readonly exitConfirmOverlay: HTMLDivElement;
  private readonly resultsOverlay: HTMLDivElement;
  private readonly resultsSeedLabel: HTMLSpanElement;
  private readonly resultsSeedText: HTMLSpanElement;
  private readonly resultsSeedCopyButton: HTMLButtonElement;
  private readonly resultsSeedMessage: HTMLParagraphElement;
  private readonly resultsTableBody: HTMLTableSectionElement;
  private readonly resultsTotalTime: HTMLSpanElement;
  private readonly resultsTotalChanges: HTMLSpanElement;
  private readonly resultsTotalMoves: HTMLSpanElement;
  private readonly countdownOverlay: HTMLDivElement;
  private readonly countdownValue: HTMLDivElement;
  private readonly temporaryBanner: HTMLDivElement;
  private readonly menuOverlay: HTMLDivElement;
  private readonly menuBackButton: HTMLButtonElement;
  private readonly menuContent: HTMLDivElement;
  private readonly menuTitle: HTMLHeadingElement;
  private readonly menuActions: HTMLDivElement;
  private readonly menuSeedInput: HTMLInputElement;
  private readonly mapViewerControls: HTMLDivElement;
  private readonly mapSearchInput: HTMLInputElement;
  private readonly mapSearchResults: HTMLDivElement;
  private readonly mapSearchEntries: MapSearchEntry[];
  private mapSearchVisibleEntries: MapSearchEntry[] = [];
  private mapSearchActiveIndex = -1;
  private readonly network: NetworkData;
  private readonly callbacks: HudCallbacks;
  private menuMode: MenuMode = "home";
  private completionDismissed = false;
  private renderedCompletionJourneyLegs: GameState["journeyLegs"] | null = null;

  constructor(root: HTMLElement, network: NetworkData, callbacks: HudCallbacks) {
    this.network = network;
    this.callbacks = callbacks;
    root.replaceChildren();
    root.className = "app-shell";
    this.shell = root;

    this.statsPanel = document.createElement("div");
    this.statsPanel.className = "hud-panel hud-left";

    this.timerPanel = document.createElement("div");
    this.timerPanel.className = "hud-panel hud-timer";

    this.timerValue = document.createElement("span");
    this.roundValue = document.createElement("span");
    this.moveValue = document.createElement("span");
    this.changeValue = document.createElement("span");
    this.stationValue = document.createElement("span");
    this.destinationValue = document.createElement("span");
    this.timerPanel.append(
      createHudMetric("Time", this.timerValue),
      createHudMetric("Changes", this.changeValue),
      createHudMetric("Moves", this.moveValue),
    );
    this.statsPanel.append(
      createHudMetric("Round", this.roundValue),
      createHudMetric("Start", this.stationValue),
      createHudMetric("Target", this.destinationValue),
    );

    this.lineIndicator = document.createElement("div");
    this.lineIndicator.className = "line-indicator";

    this.mapHost = document.createElement("div");
    this.mapHost.className = "map-host";

    this.temporaryBanner = document.createElement("div");
    this.temporaryBanner.className = "temporary-banner";
    this.temporaryBanner.textContent = "Temporary playable subset";
    this.temporaryBanner.hidden = !network.temporary;

    this.menuOverlay = document.createElement("div");
    this.menuOverlay.className = "main-menu";
    this.menuBackButton = document.createElement("button");
    this.menuBackButton.type = "button";
    this.menuBackButton.className = "menu-back";
    this.menuBackButton.textContent = "\u2190 Back";
    this.menuBackButton.addEventListener("click", () => this.setMenuMode(getPreviousMenuMode(this.menuMode)));

    this.menuContent = document.createElement("div");
    this.menuContent.className = "main-menu-content";
    this.menuTitle = document.createElement("h1");
    this.menuTitle.textContent = "Rush Hour";
    this.menuActions = document.createElement("div");
    this.menuActions.className = "main-menu-actions";
    const socialLinks = createSocialLinks();

    this.menuSeedInput = document.createElement("input");
    this.menuSeedInput.type = "text";
    this.menuSeedInput.name = "seed";
    this.menuSeedInput.autocomplete = "off";
    this.menuSeedInput.spellcheck = false;
    this.menuSeedInput.required = true;
    this.menuSeedInput.placeholder = "Enter seed";
    this.menuSeedInput.ariaLabel = "Seed";

    this.menuContent.append(this.menuTitle, this.menuActions);
    this.menuOverlay.append(this.menuBackButton, this.menuContent, socialLinks);
    this.setMenuMode("home");

    this.mapViewerControls = document.createElement("div");
    this.mapViewerControls.className = "map-viewer-controls";
    this.mapViewerControls.hidden = true;
    const mapViewerBack = document.createElement("button");
    mapViewerBack.type = "button";
    mapViewerBack.className = "map-viewer-back";
    mapViewerBack.textContent = "\u2190 Menu";
    mapViewerBack.addEventListener("click", callbacks.onReturnToMenu);
    const mapSearchForm = document.createElement("form");
    mapSearchForm.className = "map-search-form";
    this.mapSearchInput = document.createElement("input");
    this.mapSearchInput.type = "search";
    this.mapSearchInput.placeholder = "Search for a station";
    this.mapSearchInput.ariaLabel = "Search for a station";
    this.mapSearchInput.autocomplete = "off";
    this.mapSearchInput.spellcheck = false;
    this.mapSearchInput.setAttribute("role", "combobox");
    this.mapSearchInput.setAttribute("aria-autocomplete", "list");
    this.mapSearchInput.setAttribute("aria-controls", "map-station-results");
    this.mapSearchInput.setAttribute("aria-expanded", "false");
    this.mapSearchEntries = createMapSearchEntries(network);
    this.mapSearchResults = document.createElement("div");
    this.mapSearchResults.id = "map-station-results";
    this.mapSearchResults.className = "map-search-results";
    this.mapSearchResults.setAttribute("role", "listbox");
    this.mapSearchResults.hidden = true;
    const mapSearchButton = document.createElement("button");
    mapSearchButton.type = "submit";
    mapSearchButton.className = "map-search-submit";
    mapSearchButton.textContent = "Find";
    mapSearchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const stationId = findMapSearchStationId(this.mapSearchEntries, this.mapSearchInput.value);
      if (!stationId) {
        this.mapSearchInput.setCustomValidity("Choose a station from the list.");
        this.mapSearchInput.reportValidity();
        return;
      }
      this.mapSearchInput.setCustomValidity("");
      callbacks.onFocusMapStation(stationId);
      this.hideMapSearchResults();
      this.mapSearchInput.blur();
    });
    this.mapSearchInput.addEventListener("focus", () => this.renderMapSearchResults());
    this.mapSearchInput.addEventListener("input", () => {
      this.mapSearchInput.setCustomValidity("");
      this.renderMapSearchResults();
    });
    this.mapSearchInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.hideMapSearchResults();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (this.mapSearchResults.hidden) {
          this.renderMapSearchResults();
        }
        if (this.mapSearchVisibleEntries.length === 0) {
          return;
        }
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex = this.mapSearchActiveIndex < 0
          ? direction > 0 ? 0 : this.mapSearchVisibleEntries.length - 1
          : (this.mapSearchActiveIndex + direction + this.mapSearchVisibleEntries.length) %
            this.mapSearchVisibleEntries.length;
        this.setMapSearchActiveIndex(nextIndex);
        return;
      }
      if (event.key === "Enter" && !this.mapSearchResults.hidden && this.mapSearchActiveIndex >= 0) {
        event.preventDefault();
        const entry = this.mapSearchVisibleEntries[this.mapSearchActiveIndex];
        if (entry) {
          this.selectMapSearchEntry(entry);
        }
      }
    });
    mapSearchForm.addEventListener("focusout", () => {
      window.setTimeout(() => {
        if (!mapSearchForm.contains(document.activeElement)) {
          this.hideMapSearchResults();
        }
      }, 0);
    });
    mapSearchForm.append(this.mapSearchInput, mapSearchButton, this.mapSearchResults);
    this.mapViewerControls.append(mapViewerBack, mapSearchForm);

    this.countdownOverlay = document.createElement("div");
    this.countdownOverlay.className = "countdown-overlay";
    this.countdownOverlay.hidden = true;
    this.countdownValue = document.createElement("div");
    this.countdownValue.className = "countdown-value";
    this.countdownOverlay.append(this.countdownValue);

    this.completionOverlay = document.createElement("div");
    this.completionOverlay.className = "completion-overlay";
    this.completionOverlay.hidden = true;
    this.completionTitle = document.createElement("h1");
    this.completionMeta = document.createElement("p");
    this.completionMeta.className = "completion-meta";
    this.completionSeedText = document.createElement("span");
    this.completionSeedCopyButton = document.createElement("button");
    this.completionSeedCopyButton.type = "button";
    this.completionSeedCopyButton.className = "completion-copy-seed";
    this.completionSeedCopyButton.textContent = "Copy";
    this.completionSeedCopyButton.addEventListener("click", () => {
      void copyTextToClipboard(this.completionSeedText.textContent ?? "").then((copied) => {
        const originalText = this.completionSeedCopyButton.textContent;
        this.completionSeedCopyButton.textContent = copied ? "Copied" : "Copy failed";
        window.setTimeout(() => {
          this.completionSeedCopyButton.textContent = originalText;
        }, 1200);
      });
    });
    this.completionMeta.append("Seed ", this.completionSeedText, this.completionSeedCopyButton);
    this.completionTime = document.createElement("span");
    this.completionMoves = document.createElement("span");
    this.completionChanges = document.createElement("span");
    this.completionStats = document.createElement("div");
    this.completionStats.className = "completion-stats";
    this.completionStats.append(
      completionStat("Time", this.completionTime),
      completionStat("Changes", this.completionChanges),
      completionStat("Moves", this.completionMoves),
    );
    this.completionJourney = document.createElement("section");
    this.completionJourney.className = "completion-journey";
    const completionJourneyTitle = document.createElement("h2");
    completionJourneyTitle.textContent = "Journey";
    this.completionJourneyDiagram = document.createElement("div");
    this.completionJourneyDiagram.className = "journey-diagram";
    this.completionJourneyDiagram.setAttribute("role", "img");
    this.completionJourney.append(completionJourneyTitle, this.completionJourneyDiagram);
    this.completionCloseButton = document.createElement("button");
    this.completionCloseButton.type = "button";
    this.completionCloseButton.className = "completion-close";
    this.completionCloseButton.textContent = "x";
    this.completionCloseButton.ariaLabel = "Close results";
    this.completionCloseButton.addEventListener("click", () => {
      this.completionDismissed = true;
      this.completionOverlay.hidden = true;
      this.dismissedRoundActionButton.hidden = false;
    });
    this.completionQuitButton = document.createElement("button");
    this.completionQuitButton.type = "button";
    this.completionQuitButton.className = "completion-action completion-action-secondary";
    this.completionQuitButton.textContent = "Quit";
    this.completionQuitButton.addEventListener("click", callbacks.onReturnToMenu);
    this.dismissedRoundActionButton = document.createElement("button");
    this.dismissedRoundActionButton.type = "button";
    this.dismissedRoundActionButton.className = "dismissed-round-action";
    this.dismissedRoundActionButton.hidden = true;
    this.dismissedRoundActionButton.addEventListener("click", () => {
      this.completionDismissed = false;
      this.completionOverlay.hidden = false;
      this.dismissedRoundActionButton.hidden = true;
    });
    this.gameplayExitButton = document.createElement("button");
    this.gameplayExitButton.type = "button";
    this.gameplayExitButton.className = "gameplay-exit-button";
    this.gameplayExitButton.ariaLabel = "Exit to menu";
    this.gameplayExitButton.title = "Exit to menu";
    this.gameplayExitButton.hidden = true;
    this.gameplayExitButton.append(exitIcon());
    this.gameplayExitButton.addEventListener("click", () => {
      this.exitConfirmOverlay.hidden = false;
    });
    this.exitConfirmOverlay = document.createElement("div");
    this.exitConfirmOverlay.className = "exit-confirm-overlay";
    this.exitConfirmOverlay.hidden = true;
    const exitConfirmDialog = document.createElement("div");
    exitConfirmDialog.className = "exit-confirm-dialog";
    const exitConfirmMessage = document.createElement("p");
    exitConfirmMessage.textContent = "Are you sure you want to exit?";
    const exitConfirmActions = document.createElement("div");
    exitConfirmActions.className = "exit-confirm-actions";
    const exitConfirmYes = document.createElement("button");
    exitConfirmYes.type = "button";
    exitConfirmYes.className = "exit-confirm-button exit-confirm-button-primary";
    exitConfirmYes.textContent = "Yes";
    exitConfirmYes.addEventListener("click", callbacks.onReturnToMenu);
    const exitConfirmNo = document.createElement("button");
    exitConfirmNo.type = "button";
    exitConfirmNo.className = "exit-confirm-button exit-confirm-button-secondary";
    exitConfirmNo.textContent = "No";
    exitConfirmNo.addEventListener("click", () => {
      this.exitConfirmOverlay.hidden = true;
    });
    exitConfirmActions.append(exitConfirmYes, exitConfirmNo);
    exitConfirmDialog.append(exitConfirmMessage, exitConfirmActions);
    this.exitConfirmOverlay.append(exitConfirmDialog);
    this.overlayButton = document.createElement("button");
    this.overlayButton.type = "button";
    this.overlayButton.className = "completion-action";
    this.overlayButton.addEventListener("click", callbacks.onAdvanceRound);
    const completionActions = document.createElement("div");
    completionActions.className = "completion-actions";
    completionActions.append(this.completionQuitButton, this.overlayButton);
    this.completionOverlay.append(
      this.completionCloseButton,
      this.completionTitle,
      this.completionStats,
      this.completionJourney,
      this.completionMeta,
      completionActions,
    );

    this.resultsOverlay = document.createElement("div");
    this.resultsOverlay.className = "results-overlay";
    this.resultsOverlay.hidden = true;
    const resultsExit = document.createElement("button");
    resultsExit.type = "button";
    resultsExit.className = "results-nav-button results-exit";
    resultsExit.textContent = "Exit";
    resultsExit.addEventListener("click", callbacks.onReturnToMenu);
    const resultsPlayAgain = document.createElement("button");
    resultsPlayAgain.type = "button";
    resultsPlayAgain.className = "results-nav-button results-play-again";
    resultsPlayAgain.textContent = "Play Again";
    resultsPlayAgain.addEventListener("click", callbacks.onPlayAgain);
    const resultsPanel = document.createElement("div");
    resultsPanel.className = "results-panel";
    const resultsTitle = document.createElement("h1");
    resultsTitle.textContent = "Results";
    const resultsSeed = document.createElement("div");
    resultsSeed.className = "results-seed";
    this.resultsSeedLabel = document.createElement("span");
    this.resultsSeedLabel.className = "results-seed-label";
    this.resultsSeedText = document.createElement("span");
    this.resultsSeedText.className = "results-seed-value";
    this.resultsSeedCopyButton = document.createElement("button");
    this.resultsSeedCopyButton.type = "button";
    this.resultsSeedCopyButton.textContent = "Copy";
    this.resultsSeedCopyButton.addEventListener("click", () => {
      void copyTextToClipboard(this.resultsSeedText.textContent ?? "").then((copied) => {
        const originalText = this.resultsSeedCopyButton.textContent;
        this.resultsSeedCopyButton.textContent = copied ? "Copied" : "Copy failed";
        window.setTimeout(() => {
          this.resultsSeedCopyButton.textContent = originalText;
        }, 1200);
      });
    });
    this.resultsSeedMessage = document.createElement("p");
    this.resultsSeedMessage.className = "results-seed-message";
    this.resultsSeedMessage.textContent = "Challenge a friend by sharing this seed.";
    resultsSeed.append(this.resultsSeedLabel, this.resultsSeedText, this.resultsSeedCopyButton);
    const resultsTable = document.createElement("table");
    resultsTable.className = "results-table";
    const resultsTableHead = document.createElement("thead");
    const headingRow = document.createElement("tr");
    headingRow.append(
      tableCell("Round", "th"),
      tableCell("Start", "th"),
      tableCell("Target", "th"),
      tableCell("Time", "th"),
      tableCell("Changes", "th"),
      tableCell("Moves", "th"),
    );
    resultsTableHead.append(headingRow);
    this.resultsTableBody = document.createElement("tbody");
    const resultsTableFoot = document.createElement("tfoot");
    const totalRow = document.createElement("tr");
    this.resultsTotalTime = document.createElement("span");
    this.resultsTotalChanges = document.createElement("span");
    this.resultsTotalMoves = document.createElement("span");
    const totalLabel = tableCell("Total", "th");
    totalLabel.colSpan = 3;
    totalRow.append(
      totalLabel,
      tableCell(this.resultsTotalTime),
      tableCell(this.resultsTotalChanges),
      tableCell(this.resultsTotalMoves),
    );
    resultsTableFoot.append(totalRow);
    resultsTable.append(resultsTableHead, this.resultsTableBody, resultsTableFoot);
    resultsPanel.append(resultsTitle, resultsSeed, this.resultsSeedMessage, resultsTable);
    this.resultsOverlay.append(resultsExit, resultsPlayAgain, resultsPanel);

    root.append(
      this.mapHost,
      this.statsPanel,
      this.timerPanel,
      this.lineIndicator,
      this.temporaryBanner,
      this.menuOverlay,
      this.mapViewerControls,
      this.countdownOverlay,
      this.completionOverlay,
      this.exitConfirmOverlay,
      this.gameplayExitButton,
      this.dismissedRoundActionButton,
      this.resultsOverlay,
    );
  }

  showMenu(): void {
    this.shell.classList.remove("map-viewer-active");
    this.mapViewerControls.hidden = true;
    this.mapSearchInput.value = "";
    this.hideMapSearchResults();
    this.removeZoomControls();
    this.completionDismissed = false;
    this.exitConfirmOverlay.hidden = true;
    this.resultsOverlay.hidden = true;
    this.dismissedRoundActionButton.hidden = true;
    this.setMenuMode("home");
  }

  showSeedChoiceMenu(): void {
    this.shell.classList.remove("map-viewer-active");
    this.mapViewerControls.hidden = true;
    this.completionDismissed = false;
    this.exitConfirmOverlay.hidden = true;
    this.resultsOverlay.hidden = true;
    this.dismissedRoundActionButton.hidden = true;
    this.setMenuMode("seed-choice");
  }

  showResults(results: RunResults): void {
    this.shell.classList.remove("map-viewer-active");
    this.mapViewerControls.hidden = true;
    this.shell.classList.remove("countdown-active");
    this.shell.classList.add("menu-active");
    this.statsPanel.hidden = true;
    this.timerPanel.hidden = true;
    this.lineIndicator.hidden = true;
    this.temporaryBanner.hidden = true;
    this.menuOverlay.hidden = true;
    this.completionOverlay.hidden = true;
    this.gameplayExitButton.hidden = true;
    this.countdownOverlay.hidden = true;
    this.exitConfirmOverlay.hidden = true;
    this.dismissedRoundActionButton.hidden = true;
    this.resultsOverlay.hidden = false;
    this.resultsSeedLabel.textContent = results.seedSource === "set" ? "Set Seed:" : "Seed:";
    this.resultsSeedText.textContent = results.seed;
    this.resultsSeedCopyButton.hidden = results.seedSource === "set";
    this.resultsSeedMessage.hidden = results.seedSource !== "random";
    const orderedStats = [...results.roundStats].sort((left, right) => left.roundNumber - right.roundNumber);
    this.resultsTableBody.replaceChildren(
      ...orderedStats.map((stats) => {
        const round = results.rounds[stats.roundNumber - 1];
        const startStation = getStation(this.network, round.startStationId);
        const targetStation = getStation(this.network, round.destinationStationId);
        const row = document.createElement("tr");
        row.append(
          tableCell(String(stats.roundNumber), "th"),
          tableCell(startStation.name),
          tableCell(targetStation.name),
          tableCell(formatMilliseconds(stats.timeMs)),
          tableCell(String(stats.lineChanges)),
          tableCell(String(stats.moves)),
        );
        return row;
      }),
    );
    const totals = orderedStats.reduce(
      (total, stats) => ({
        timeMs: total.timeMs + stats.timeMs,
        lineChanges: total.lineChanges + stats.lineChanges,
        moves: total.moves + stats.moves,
      }),
      { timeMs: 0, lineChanges: 0, moves: 0 },
    );
    this.resultsTotalTime.textContent = formatMilliseconds(totals.timeMs);
    this.resultsTotalChanges.textContent = String(totals.lineChanges);
    this.resultsTotalMoves.textContent = String(totals.moves);
    this.removeZoomControls();
  }

  showCountdown(value: number): void {
    this.shell.classList.remove("map-viewer-active");
    this.mapViewerControls.hidden = true;
    this.shell.classList.remove("menu-active");
    this.shell.classList.add("countdown-active");
    this.statsPanel.hidden = true;
    this.timerPanel.hidden = true;
    this.lineIndicator.hidden = true;
    this.temporaryBanner.hidden = true;
    this.menuOverlay.hidden = true;
    this.completionOverlay.hidden = true;
    this.gameplayExitButton.hidden = true;
    this.countdownOverlay.hidden = false;
    this.countdownValue.textContent = String(value);
    this.exitConfirmOverlay.hidden = true;
    this.resultsOverlay.hidden = true;
    this.dismissedRoundActionButton.hidden = true;
    this.removeZoomControls();
  }

  update(
    state: GameState | null,
    now: number,
    runState: RunState | null = null,
    completionReady = true,
  ): void {
    this.shell.classList.remove("map-viewer-active");
    this.mapViewerControls.hidden = true;
    if (!state) {
      this.shell.classList.remove("countdown-active");
      this.shell.classList.add("menu-active");
      this.statsPanel.hidden = true;
      this.timerPanel.hidden = true;
      this.lineIndicator.hidden = true;
      this.temporaryBanner.hidden = true;
      this.menuOverlay.hidden = false;
      this.completionOverlay.hidden = true;
      this.gameplayExitButton.hidden = true;
      this.countdownOverlay.hidden = true;
      this.exitConfirmOverlay.hidden = true;
      this.resultsOverlay.hidden = true;
      this.dismissedRoundActionButton.hidden = true;
      this.removeZoomControls();
      return;
    }

    this.shell.classList.remove("countdown-active");
    this.shell.classList.remove("menu-active");
    this.statsPanel.hidden = false;
    this.timerPanel.hidden = false;
    this.lineIndicator.hidden = false;
    this.temporaryBanner.hidden = !this.network.temporary;
    this.menuOverlay.hidden = true;
    this.countdownOverlay.hidden = true;
    this.resultsOverlay.hidden = true;
    this.gameplayExitButton.hidden = false;

    const startStation = getStation(this.network, state.startStationId);
    const destination = getStation(this.network, state.destinationStationId);
    const elapsed = getElapsedMilliseconds(state, now);

    renderMilliseconds(this.timerValue, elapsed);
    this.roundValue.textContent = runState ? String(runState.currentRoundIndex + 1) : "-";
    this.moveValue.textContent = String(state.moveCount);
    this.changeValue.textContent = String(state.changeCount);
    this.stationValue.textContent = startStation.name;
    this.destinationValue.textContent = destination.name;

    this.renderLineIndicator(state);

    if (!state.completed || !completionReady) {
      this.completionDismissed = false;
      this.dismissedRoundActionButton.hidden = true;
      this.removeZoomControls();
    }
    const showCompletion = state.completed && completionReady;
    this.completionOverlay.hidden = !showCompletion || this.completionDismissed;
    this.dismissedRoundActionButton.hidden = !showCompletion || !this.completionDismissed;
    if (showCompletion && runState) {
      const actionLabel = runState.currentRoundIndex >= ROUND_COUNT - 1 ? "Finish" : "Next Round";
      this.completionTitle.textContent = `Round ${runState.currentRoundIndex + 1} Complete`;
      this.completionTime.classList.remove("time-value");
      this.completionTime.textContent = formatMilliseconds(elapsed);
      this.completionMoves.textContent = String(state.moveCount);
      this.completionChanges.textContent = String(state.changeCount);
      this.renderCompletionJourney(state);
      this.completionJourney.hidden = false;
      this.completionMeta.hidden = true;
      this.completionStats.hidden = false;
      this.completionCloseButton.hidden = false;
      this.overlayButton.textContent = actionLabel;
      this.dismissedRoundActionButton.textContent = actionLabel;
      this.ensureZoomControls();
    }
  }

  private renderCompletionJourney(state: GameState): void {
    if (this.renderedCompletionJourneyLegs === state.journeyLegs) {
      return;
    }
    this.renderedCompletionJourneyLegs = state.journeyLegs;

    const summary = createJourneySummary(state);
    const stationNames = summary.stops.map((stop) =>
      formatJourneyStationName(getStation(this.network, stop.stationId).name)
    );
    const lineNames = summary.segments.map((segment) => LINE_BY_ID[segment.lineId].name);
    const routeDescription = stationNames.length > 2
      ? `${stationNames[0]}, changing at ${stationNames.slice(1, -1).join(", ")}, to ${stationNames.at(-1)}`
      : `${stationNames[0]} to ${stationNames[1]}`;

    this.completionJourneyDiagram.ariaLabel = `Journey ${routeDescription}. Lines: ${lineNames.join(", ")}.`;

    const viewport = document.createElement("div");
    viewport.className = "journey-viewport";
    const route = document.createElement("div");
    route.className = "journey-route";
    route.style.minWidth = `${Math.max(360, summary.stops.length * 112)}px`;
    route.style.setProperty(
      "--journey-line-width",
      `${(LINE_STROKE_WIDTH / GRID_CELL_SIZE) * JOURNEY_MARKER_SIZE}px`,
    );

    summary.stops.forEach((stop, index) => {
      const lineId = index === summary.stops.length - 1
        ? summary.segments[index - 1].lineId
        : summary.segments[index].lineId;
      route.append(createJourneyStop(stationNames[index], stop.kind, LINE_BY_ID[lineId].color));

      const segment = summary.segments[index];
      if (segment) {
        const line = LINE_BY_ID[segment.lineId];
        const segmentElement = document.createElement("div");
        segmentElement.className = segment.lineId === "walk"
          ? "journey-segment journey-segment-walk"
          : "journey-segment";
        segmentElement.style.setProperty("--journey-line-color", line.color);
        segmentElement.title = line.name;
        route.append(segmentElement);
      }
    });

    viewport.append(route);
    this.completionJourneyDiagram.replaceChildren(viewport);
  }

  showMapViewer(): void {
    this.shell.classList.remove("menu-active", "countdown-active");
    this.shell.classList.add("map-viewer-active");
    this.statsPanel.hidden = true;
    this.timerPanel.hidden = true;
    this.lineIndicator.hidden = true;
    this.temporaryBanner.hidden = true;
    this.menuOverlay.hidden = true;
    this.completionOverlay.hidden = true;
    this.gameplayExitButton.hidden = true;
    this.countdownOverlay.hidden = true;
    this.exitConfirmOverlay.hidden = true;
    this.dismissedRoundActionButton.hidden = true;
    this.resultsOverlay.hidden = true;
    this.mapViewerControls.hidden = false;
    this.ensureZoomControls();
  }

  private renderMapSearchResults(): void {
    this.mapSearchVisibleEntries = filterMapSearchEntries(this.mapSearchEntries, this.mapSearchInput.value);
    this.mapSearchActiveIndex = -1;
    this.mapSearchResults.replaceChildren(...this.mapSearchVisibleEntries.map((entry, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.id = `map-station-result-${entry.stationId}`;
      option.className = "map-search-result";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.tabIndex = -1;
      option.textContent = entry.label;
      option.addEventListener("pointerdown", (event) => event.preventDefault());
      option.addEventListener("pointerenter", () => this.setMapSearchActiveIndex(index));
      option.addEventListener("click", () => this.selectMapSearchEntry(entry));
      return option;
    }));
    this.mapSearchResults.hidden = this.mapSearchVisibleEntries.length === 0;
    this.mapSearchInput.setAttribute("aria-expanded", String(!this.mapSearchResults.hidden));
  }

  private setMapSearchActiveIndex(index: number): void {
    if (this.mapSearchVisibleEntries.length === 0) {
      return;
    }
    this.mapSearchActiveIndex = Math.max(0, Math.min(index, this.mapSearchVisibleEntries.length - 1));
    const options = [...this.mapSearchResults.querySelectorAll<HTMLButtonElement>(".map-search-result")];
    options.forEach((option, optionIndex) => {
      const active = optionIndex === this.mapSearchActiveIndex;
      option.classList.toggle("map-search-result-active", active);
      option.setAttribute("aria-selected", String(active));
      if (active) {
        this.mapSearchInput.setAttribute("aria-activedescendant", option.id);
        option.scrollIntoView({ block: "nearest" });
      }
    });
  }

  private selectMapSearchEntry(entry: MapSearchEntry): void {
    this.mapSearchInput.value = entry.label;
    this.mapSearchInput.setCustomValidity("");
    this.callbacks.onFocusMapStation(entry.stationId);
    this.hideMapSearchResults();
    this.mapSearchInput.blur();
  }

  private hideMapSearchResults(): void {
    this.mapSearchResults.hidden = true;
    this.mapSearchActiveIndex = -1;
    this.mapSearchInput.setAttribute("aria-expanded", "false");
    this.mapSearchInput.removeAttribute("aria-activedescendant");
  }

  private setMenuMode(mode: MenuMode): void {
    this.menuMode = mode;
    this.menuOverlay.dataset.menuMode = mode;
    this.menuBackButton.hidden = mode === "home";
    this.menuTitle.hidden = mode === "how-to-play";
    this.menuTitle.textContent = "Rush Hour";
    this.menuActions.replaceChildren();

    if (mode === "home") {
      this.menuActions.append(
        menuButton("Play", "primary", () => this.setMenuMode("seed-choice")),
        menuButton("How to Play", "secondary", () => this.setMenuMode("how-to-play")),
        menuButton("Map", "secondary", this.callbacks.onOpenMap),
      );
      return;
    }

    if (mode === "how-to-play") {
      this.menuActions.append(createHowToPlayContent());
      return;
    }

    if (mode === "seed-choice") {
      this.menuActions.append(
        menuButton("Random Seed", "primary", this.callbacks.onStartRandomSeed),
        menuButton("Set Seed", "secondary", () => this.setMenuMode("seed-entry")),
      );
      return;
    }

    const form = document.createElement("form");
    form.className = "main-menu-seed-form";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const seed = this.menuSeedInput.value.trim();
      if (seed === "") {
        this.menuSeedInput.focus();
        return;
      }
      this.callbacks.onStartSeed(seed);
    });

    this.menuSeedInput.value = "";
    form.append(
      this.menuSeedInput,
      menuButton("Start", "primary"),
    );
    this.menuActions.append(form);
    window.setTimeout(() => this.menuSeedInput.focus(), 0);
  }

  private renderLineIndicator(state: GameState): void {
    const preview = getLineCyclePreview(state, this.network);
    this.lineIndicator.replaceChildren();
    this.lineIndicator.style.removeProperty("--line-color");
    this.lineIndicator.style.removeProperty("--line-text-color");

    if (!preview) {
      this.lineIndicator.textContent = "Ready";
      return;
    }

    const canSwitch = preview.lineCount > 1;
    this.lineIndicator.append(
      lineChip("A", preview.previous, canSwitch ? "preview" : "disabled"),
      lineChip("Now", preview.current, "current"),
      lineChip("D", preview.next, canSwitch ? "preview" : "disabled"),
    );
  }

  private ensureZoomControls(): void {
    if (this.zoomControls) {
      return;
    }

    this.zoomControls = document.createElement("div");
    this.zoomControls.className = "zoom-controls";
    this.zoomControls.append(
      zoomButton("+", "Zoom in", this.callbacks.onZoomIn),
      zoomButton("-", "Zoom out", this.callbacks.onZoomOut),
    );
    this.completionOverlay.before(this.zoomControls);
  }

  private removeZoomControls(): void {
    this.zoomControls?.remove();
    this.zoomControls = null;
  }
}

function menuButton(
  label: string,
  variant: "primary" | "secondary",
  callback?: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = callback ? "button" : "submit";
  button.className = `main-menu-button main-menu-button-${variant}`;
  button.textContent = label;
  if (callback) {
    button.addEventListener("click", callback);
  }
  return button;
}

export function createMapSearchEntries(network: NetworkData): MapSearchEntry[] {
  const nameCounts = new Map<string, number>();
  for (const station of network.stations) {
    const key = normalizeStationSearch(station.name);
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  return network.stations
    .map((station) => {
      const duplicateName = (nameCounts.get(normalizeStationSearch(station.name)) ?? 0) > 1;
      const lineNames = station.lines
        .filter((lineId) => lineId !== "walk")
        .map((lineId) => LINE_BY_ID[lineId].name)
        .join(", ");
      return {
        label: duplicateName && lineNames !== "" ? `${station.name} \u2014 ${lineNames}` : station.name,
        stationId: station.id,
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label, "en-GB"));
}

export function findMapSearchStationId(entries: readonly MapSearchEntry[], query: string): string | null {
  const normalizedQuery = normalizeStationSearch(query);
  if (normalizedQuery === "") {
    return null;
  }

  const exactMatches = entries.filter((entry) => normalizeStationSearch(entry.label) === normalizedQuery);
  if (exactMatches.length === 1) {
    return exactMatches[0].stationId;
  }

  const nameMatches = entries.filter((entry) =>
    normalizeStationSearch(entry.label.split("\u2014", 1)[0]) === normalizedQuery
  );
  if (nameMatches.length === 1) {
    return nameMatches[0].stationId;
  }

  const partialMatches = entries.filter((entry) => normalizeStationSearch(entry.label).includes(normalizedQuery));
  return partialMatches.length === 1 ? partialMatches[0].stationId : null;
}

export function filterMapSearchEntries(
  entries: readonly MapSearchEntry[],
  query: string,
): MapSearchEntry[] {
  const normalizedQuery = normalizeStationSearch(query);
  if (normalizedQuery === "") {
    return [...entries];
  }
  return entries.filter((entry) => normalizeStationSearch(entry.label).includes(normalizedQuery));
}

function normalizeStationSearch(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("en-GB")
    .replace(/\s+/g, " ");
}

export function getPreviousMenuMode(mode: MenuMode): MenuMode {
  if (mode === "seed-entry") {
    return "seed-choice";
  }
  return "home";
}

function createSocialLinks(): HTMLDivElement {
  const links = document.createElement("div");
  links.className = "main-menu-social-links";
  links.append(...SOCIAL_LINKS.map((socialLink) => createSocialLink(socialLink)));
  return links;
}

function createSocialLink({ id, label, href }: { id: SocialLinkId; label: string; href: string }): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = "main-menu-social-link";
  link.href = href;
  link.ariaLabel = label;
  link.title = label;
  if (href === "#") {
    link.addEventListener("click", (event) => event.preventDefault());
  } else {
    link.target = "_blank";
    link.rel = "noreferrer";
  }
  link.append(socialIcon(id));
  return link;
}

function socialIcon(id: SocialLinkId): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "social-icon");

  if (id === "github") {
    svg.append(svgPath("M 12 3.7 C 7.3 3.7 3.5 7.5 3.5 12.1 C 3.5 15.8 5.9 18.9 9.2 20 C 9.6 20.1 9.8 19.8 9.8 19.6 V 18 C 7.5 18.5 7 17 7 17 C 6.6 16 6 15.7 6 15.7 C 5.2 15.1 6.1 15.1 6.1 15.1 C 7 15.2 7.5 16 7.5 16 C 8.3 17.4 9.6 17 9.8 16.8 C 9.9 16.2 10.1 15.8 10.4 15.5 C 8.5 15.3 6.6 14.6 6.6 11.4 C 6.6 10.5 6.9 9.8 7.5 9.2 C 7.4 9 7.1 8.1 7.6 7 C 7.6 7 8.4 6.8 9.9 7.9 C 10.6 7.7 11.3 7.6 12 7.6 C 12.7 7.6 13.4 7.7 14.1 7.9 C 15.6 6.8 16.4 7 16.4 7 C 16.9 8.1 16.6 9 16.5 9.2 C 17.1 9.8 17.4 10.5 17.4 11.4 C 17.4 14.6 15.5 15.3 13.6 15.5 C 13.9 15.8 14.2 16.4 14.2 17.3 V 19.6 C 14.2 19.8 14.4 20.1 14.8 20 C 18.1 18.9 20.5 15.8 20.5 12.1 C 20.5 7.5 16.7 3.7 12 3.7 Z"));
    return svg;
  }

  if (id === "reddit") {
    const antenna = svgPath("M 14 7 L 15.2 4.7 L 18 5.3");
    antenna.setAttribute("fill", "none");
    antenna.setAttribute("stroke", "currentColor");
    antenna.setAttribute("stroke-width", "1.8");
    antenna.setAttribute("stroke-linecap", "round");
    antenna.setAttribute("stroke-linejoin", "round");
    svg.append(
      antenna,
      svgPath("M 19.3 8.3 C 20.3 8.3 21.1 9.1 21.1 10.1 C 21.1 10.8 20.7 11.4 20.2 11.7 C 20.2 11.9 20.2 12 20.2 12.2 C 20.2 15.3 16.5 17.8 12 17.8 C 7.5 17.8 3.8 15.3 3.8 12.2 C 3.8 12 3.8 11.9 3.8 11.7 C 3.3 11.4 2.9 10.8 2.9 10.1 C 2.9 9.1 3.7 8.3 4.7 8.3 C 5.2 8.3 5.7 8.5 6 8.8 C 7.5 7.8 9.6 7.2 12 7.2 C 14.4 7.2 16.5 7.8 18 8.8 C 18.3 8.5 18.8 8.3 19.3 8.3 Z"),
      svgCircle(9.1, 11.7, 1.1),
      svgCircle(14.9, 11.7, 1.1),
    );
    const smile = svgPath("M 8.9 14.2 C 10.5 15.3 13.5 15.3 15.1 14.2");
    smile.setAttribute("fill", "none");
    smile.setAttribute("stroke", "#ffffff");
    smile.setAttribute("stroke-width", "1.5");
    smile.setAttribute("stroke-linecap", "round");
    svg.append(smile);
    return svg;
  }

  svg.append(svgPath("M 4.2 4.8 H 8.1 L 12.7 10.8 L 17.7 4.8 H 20.2 L 13.9 12.2 L 20.6 19.2 H 16.6 L 11.8 12.9 L 6.4 19.2 H 3.9 L 10.6 11.3 Z M 7.2 6.5 L 17.3 17.5 H 17.8 L 7.7 6.5 Z"));
  return svg;
}

function svgPath(d: string): SVGPathElement {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  return path;
}

function svgCircle(cx: number, cy: number, r: number): SVGCircleElement {
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", String(cx));
  circle.setAttribute("cy", String(cy));
  circle.setAttribute("r", String(r));
  circle.setAttribute("fill", "#ffffff");
  return circle;
}

function exitIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "button-icon");

  const door = document.createElementNS("http://www.w3.org/2000/svg", "path");
  door.setAttribute("d", "M 5 4 H 12 V 7 H 8 V 17 H 12 V 20 H 5 Z");

  const arrow = document.createElementNS("http://www.w3.org/2000/svg", "path");
  arrow.setAttribute("d", "M 13 8 L 17 12 L 13 16 V 13 H 9 V 11 H 13 Z");

  svg.append(door, arrow);
  return svg;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (text === "") {
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const input = document.createElement("input");
    input.value = text;
    input.setAttribute("readonly", "true");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    return copied;
  }
}

function zoomButton(label: string, ariaLabel: string, callback: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.ariaLabel = ariaLabel;
  button.title = ariaLabel;
  button.addEventListener("click", callback);
  return button;
}

function lineChip(label: string, lineId: keyof typeof LINE_BY_ID, variant: "preview" | "current" | "disabled"): HTMLDivElement {
  const line = LINE_BY_ID[lineId];
  const chip = document.createElement("div");
  chip.className = `line-chip line-chip-${variant}`;
  chip.style.setProperty("--chip-line-color", lineId === "walk" ? "#ffffff" : line.color);
  chip.style.setProperty("--chip-line-text-color", lineId === "walk" ? "#111111" : line.textColor);

  const key = document.createElement("span");
  key.className = "line-chip-key";
  key.textContent = label;

  const name = document.createElement("span");
  name.className = "line-chip-name";
  name.textContent = line.name;

  chip.append(key, name);
  return chip;
}

function completionStat(label: string, valueElement: HTMLSpanElement): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.className = "completion-stat";

  const labelElement = document.createElement("span");
  labelElement.className = "completion-stat-label";
  labelElement.textContent = label;

  valueElement.className = "completion-stat-value";
  wrapper.append(labelElement, valueElement);
  return wrapper;
}

function createJourneyStop(
  stationName: string,
  kind: "start" | "interchange" | "destination",
  lineColor: string,
): HTMLDivElement {
  const stop = document.createElement("div");
  stop.className = `journey-stop journey-stop-${kind}`;

  const marker = document.createElementNS(SVG_NS, "svg");
  marker.setAttribute(
    "viewBox",
    `${-GRID_CELL_SIZE / 2} ${-GRID_CELL_SIZE / 2} ${GRID_CELL_SIZE} ${GRID_CELL_SIZE}`,
  );
  marker.setAttribute("width", String(JOURNEY_MARKER_SIZE));
  marker.setAttribute("height", String(JOURNEY_MARKER_SIZE));
  marker.setAttribute("class", "journey-marker");
  marker.ariaHidden = "true";
  marker.append(
    kind === "interchange"
      ? createInterchangeMarker("journey-interchange-marker", INTERCHANGE_OUTLINE_WIDTH / 2)
      : createBarMarker({ x: 1, y: 0 }, lineColor),
  );

  const label = document.createElement("span");
  label.className = "journey-station-name";
  label.textContent = stationName;

  stop.append(marker, label);
  return stop;
}

function tableCell(content: string | HTMLElement, tag: "td" | "th" = "td"): HTMLTableCellElement {
  const cell = document.createElement(tag);
  if (typeof content === "string") {
    cell.textContent = content;
  } else {
    cell.append(content);
  }
  return cell;
}

export function formatMilliseconds(milliseconds: number): string {
  const { minutes, seconds, centiseconds } = getTimeParts(milliseconds);
  return `${minutes}:${seconds}.${centiseconds}`;
}

function renderMilliseconds(element: HTMLElement, milliseconds: number): void {
  const { minutes, seconds, centiseconds } = getTimeParts(milliseconds);
  renderTimeValue(element, { minutes, seconds, fraction: centiseconds });
}

function getTimeParts(milliseconds: number): { minutes: string; seconds: string; centiseconds: string } {
  const totalCentiseconds = Math.floor(milliseconds / 10);
  const minutes = Math.floor(totalCentiseconds / 6000);
  const seconds = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;

  return {
    minutes: String(minutes),
    seconds: seconds.toString().padStart(2, "0"),
    centiseconds: centiseconds.toString().padStart(2, "0"),
  };
}
