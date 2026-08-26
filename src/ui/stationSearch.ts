import { LINE_BY_ID } from "../data/lines";
import type { NetworkData } from "../data/types";

export type MapSearchEntry = { label: string; stationId: string };

export type StationSearchOptions = {
  readonly formClassName: string;
  readonly resultsId: string;
  readonly optionIdPrefix: string;
  readonly entries: readonly MapSearchEntry[];
  readonly onSelect: (stationId: string) => void;
  readonly stopEscapePropagation?: boolean;
};

const STATION_SEARCH_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const TOUCH_DEVICE_QUERY = "(hover: none) and (pointer: coarse)";

export class StationSearch {
  readonly form: HTMLFormElement;
  readonly input: HTMLInputElement;
  readonly results: HTMLDivElement;

  private readonly alphabet: HTMLDivElement;
  private readonly browseOnlyQuery: MediaQueryList;
  private readonly entries: readonly MapSearchEntry[];
  private readonly onSelect: (stationId: string) => void;
  private readonly stopEscapePropagation: boolean;
  private readonly optionIdPrefix: string;
  private visibleEntries: MapSearchEntry[] = [];
  private activeIndex = -1;

  constructor(options: StationSearchOptions) {
    this.entries = options.entries;
    this.onSelect = options.onSelect;
    this.stopEscapePropagation = options.stopEscapePropagation ?? false;
    this.optionIdPrefix = options.optionIdPrefix;
    this.form = document.createElement("form");
    this.form.className = options.formClassName;
    this.input = document.createElement("input");
    this.input.type = "search";
    this.input.placeholder = "Search for a station";
    this.input.ariaLabel = "Search for a station";
    this.input.autocomplete = "off";
    this.input.spellcheck = false;
    this.input.setAttribute("role", "combobox");
    this.input.setAttribute("aria-autocomplete", "list");
    this.input.setAttribute("aria-controls", options.resultsId);
    this.input.setAttribute("aria-expanded", "false");
    this.alphabet = document.createElement("div");
    this.alphabet.className = "station-search-alphabet";
    this.alphabet.setAttribute("aria-label", "Station list alphabet");
    this.alphabet.hidden = true;
    const availableInitials = new Set(this.entries.map((entry) => getInitialLetter(entry.label)));
    for (const letter of STATION_SEARCH_ALPHABET) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = letter;
      button.ariaLabel = `Jump to stations beginning with ${letter}`;
      button.setAttribute("aria-controls", options.resultsId);
      button.disabled = !availableInitials.has(letter);
      button.addEventListener("pointerdown", (event) => event.preventDefault());
      button.addEventListener("click", () => this.jumpToLetter(letter));
      this.alphabet.append(button);
    }
    this.results = document.createElement("div");
    this.results.id = options.resultsId;
    this.results.className = "map-search-results";
    this.results.setAttribute("role", "listbox");
    this.results.hidden = true;
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "map-search-submit";
    submit.textContent = "Find";
    this.form.append(this.input, submit, this.results, this.alphabet);
    this.browseOnlyQuery = window.matchMedia(TOUCH_DEVICE_QUERY);
    this.applyBrowseOnlyMode();
    this.bindEvents();
  }

  reset(): void {
    this.input.value = "";
    this.input.setCustomValidity("");
    this.hide();
  }

  hide(): void {
    this.results.hidden = true;
    this.alphabet.hidden = true;
    this.activeIndex = -1;
    this.input.setAttribute("aria-expanded", "false");
    this.input.removeAttribute("aria-activedescendant");
  }

  private bindEvents(): void {
    const updateBrowseOnlyMode = () => this.applyBrowseOnlyMode();
    if (typeof this.browseOnlyQuery.addEventListener === "function") {
      this.browseOnlyQuery.addEventListener("change", updateBrowseOnlyMode);
    } else {
      this.browseOnlyQuery.addListener(updateBrowseOnlyMode);
    }
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (this.isBrowseOnly()) {
        this.renderResults();
        return;
      }
      const stationId = findMapSearchStationId(this.entries, this.input.value);
      if (!stationId) {
        this.input.setCustomValidity("Choose a station from the list.");
        this.input.reportValidity();
        return;
      }
      this.input.setCustomValidity("");
      this.onSelect(stationId);
      this.hide();
      this.input.blur();
    });
    this.input.addEventListener("focus", () => this.renderResults());
    this.input.addEventListener("input", () => {
      this.input.setCustomValidity("");
      this.renderResults();
    });
    this.input.addEventListener("keydown", (event) => this.handleKeyDown(event));
    this.form.addEventListener("focusout", () => {
      window.setTimeout(() => {
        if (!this.form.contains(document.activeElement)) this.hide();
      }, 0);
    });
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      if (this.stopEscapePropagation) event.stopPropagation();
      this.hide();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (this.results.hidden) this.renderResults();
      if (this.visibleEntries.length === 0) return;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = this.activeIndex < 0
        ? direction > 0 ? 0 : this.visibleEntries.length - 1
        : (this.activeIndex + direction + this.visibleEntries.length) % this.visibleEntries.length;
      this.setActiveIndex(nextIndex);
      return;
    }
    if (event.key === "Enter" && !this.results.hidden && this.activeIndex >= 0) {
      event.preventDefault();
      const entry = this.visibleEntries[this.activeIndex];
      if (entry) this.selectEntry(entry);
      return;
    }
    if (this.isBrowseOnly() && (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete")) {
      event.preventDefault();
    }
  }

  private renderResults(): void {
    const query = this.isBrowseOnly() ? "" : this.input.value;
    this.visibleEntries = filterMapSearchEntries(this.entries, query);
    this.activeIndex = -1;
    this.results.replaceChildren(...this.visibleEntries.map((entry, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.id = `${this.optionIdPrefix}-${entry.stationId}`;
      option.className = "map-search-result";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.tabIndex = -1;
      option.textContent = entry.label;
      option.addEventListener("pointerdown", (event) => event.preventDefault());
      option.addEventListener("pointerenter", () => this.setActiveIndex(index));
      option.addEventListener("click", () => this.selectEntry(entry));
      return option;
    }));
    this.results.hidden = this.visibleEntries.length === 0;
    this.alphabet.hidden = !this.isBrowseOnly() || this.results.hidden;
    this.input.setAttribute("aria-expanded", String(!this.results.hidden));
  }

  private setActiveIndex(index: number, block: ScrollLogicalPosition = "nearest"): void {
    if (this.visibleEntries.length === 0) return;
    this.activeIndex = Math.max(0, Math.min(index, this.visibleEntries.length - 1));
    const options = [...this.results.querySelectorAll<HTMLButtonElement>(".map-search-result")];
    options.forEach((option, optionIndex) => {
      const active = optionIndex === this.activeIndex;
      option.classList.toggle("map-search-result-active", active);
      option.setAttribute("aria-selected", String(active));
      if (active) {
        this.input.setAttribute("aria-activedescendant", option.id);
        option.scrollIntoView({ block });
      }
    });
  }

  private applyBrowseOnlyMode(): void {
    const browseOnly = this.isBrowseOnly();
    this.form.classList.toggle("station-search-browse-only", browseOnly);
    this.input.readOnly = browseOnly;
    this.input.inputMode = browseOnly ? "none" : "search";
    this.input.setAttribute("aria-autocomplete", browseOnly ? "none" : "list");
    if (!browseOnly) this.alphabet.hidden = true;
    if (!this.results.hidden) this.renderResults();
  }

  private isBrowseOnly(): boolean {
    return this.browseOnlyQuery.matches;
  }

  private jumpToLetter(letter: string): void {
    if (this.results.hidden) this.renderResults();
    const index = findAlphabetJumpIndex(this.visibleEntries, letter);
    if (index >= 0) this.setActiveIndex(index, "start");
  }

  private selectEntry(entry: MapSearchEntry): void {
    this.input.value = entry.label;
    this.input.setCustomValidity("");
    this.onSelect(entry.stationId);
    this.hide();
    this.input.blur();
  }
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
  if (normalizedQuery === "") return null;
  const exactMatches = entries.filter((entry) => normalizeStationSearch(entry.label) === normalizedQuery);
  if (exactMatches.length === 1) return exactMatches[0].stationId;
  const nameMatches = entries.filter((entry) =>
    normalizeStationSearch(entry.label.split("\u2014", 1)[0]) === normalizedQuery
  );
  if (nameMatches.length === 1) return nameMatches[0].stationId;
  const partialMatches = entries.filter((entry) => normalizeStationSearch(entry.label).includes(normalizedQuery));
  return partialMatches.length === 1 ? partialMatches[0].stationId : null;
}

export function filterMapSearchEntries(
  entries: readonly MapSearchEntry[],
  query: string,
): MapSearchEntry[] {
  const normalizedQuery = normalizeStationSearch(query);
  return normalizedQuery === ""
    ? [...entries]
    : entries.filter((entry) => normalizeStationSearch(entry.label).includes(normalizedQuery));
}

export function findAlphabetJumpIndex(
  entries: readonly MapSearchEntry[],
  requestedLetter: string,
): number {
  const letter = requestedLetter.trim().charAt(0).toLocaleUpperCase("en-GB");
  if (!/^[A-Z]$/.test(letter)) return -1;
  return entries.findIndex((entry) => getInitialLetter(entry.label) === letter);
}

function getInitialLetter(label: string): string {
  return label.trim().charAt(0).toLocaleUpperCase("en-GB");
}

function normalizeStationSearch(value: string): string {
  return value.trim().toLocaleLowerCase("en-GB").replace(/\s+/g, " ");
}
