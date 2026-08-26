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
  let minutes = element.querySelector<HTMLSpanElement>(".time-minutes");
  let seconds = element.querySelector<HTMLSpanElement>(".time-seconds");
  let fraction = element.querySelector<HTMLSpanElement>(".time-centiseconds");
  if (!minutes || !seconds || !fraction || element.children.length !== 5) {
    minutes = timePart(parts.minutes, "time-minutes");
    seconds = timePart(parts.seconds, "time-seconds");
    fraction = timePart(parts.fraction, "time-centiseconds");
    element.replaceChildren(
      minutes,
      timePart(":", "time-separator"),
      seconds,
      timePart(".", "time-separator"),
      fraction,
    );
    return;
  }

  setText(minutes, parts.minutes);
  setText(seconds, parts.seconds);
  setText(fraction, parts.fraction);
}

function timePart(text: string, className: string): HTMLSpanElement {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = text;
  return element;
}

function setText(element: HTMLElement, value: string): void {
  if (element.textContent !== value) {
    element.textContent = value;
  }
}
