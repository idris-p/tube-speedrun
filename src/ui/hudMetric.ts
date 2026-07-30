export type TimeValueParts = {
  minutes: string;
  seconds: string;
  fraction: string;
};

export function createHudMetric(label: string, valueElement: HTMLSpanElement): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.className = "metric";

  const labelElement = document.createElement("span");
  labelElement.className = "metric-label";
  labelElement.textContent = label;

  valueElement.className = "metric-value";
  wrapper.append(labelElement, valueElement);
  return wrapper;
}

export function renderTimeValue(element: HTMLElement, parts: TimeValueParts): void {
  element.classList.add("time-value");
  element.replaceChildren(
    timePart(parts.minutes, "time-minutes"),
    timePart(":", "time-separator"),
    timePart(parts.seconds, "time-seconds"),
    timePart(".", "time-separator"),
    timePart(parts.fraction, "time-centiseconds"),
  );
}

function timePart(text: string, className: string): HTMLSpanElement {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = text;
  return element;
}
