import "./style.css";
import { parseReport, severities, storedReviews, summarize, type Review } from "./reviews.js";

const storageKey = "pr-mentor.dashboard.v1";
const maxReportBytes = 2_000_000;
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const labels = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

function sampleReview(
  id: string,
  title: string,
  repository: string,
  date: string,
  findings: Review["findings"],
): Review {
  return { id, title, repository, date, findings, status: "ok", message: "" };
}

const testGap = {
  title: "Missing tests for new behavior",
  severity: "medium",
  category: "tests",
  ruleId: "heuristic/missing-tests",
  file: "src/cart.ts",
  line: 17,
  explanation: "The new branch has no matching test coverage.",
  suggestion: "Add a test for the new behavior and one for the failure case.",
} as const;
const sample = [
  sampleReview("checkout", "Add checkout validation", "class/shop-api", "2026-11-24T12:00:00Z", [
    {
      title: "Unvalidated request data",
      severity: "high",
      category: "security",
      file: "src/checkout.ts",
      line: 32,
      explanation: "The handler uses the payload before checking its shape.",
      suggestion: "Validate the payload at the request boundary before reading its fields.",
    },
    testGap,
  ]),
  sampleReview("routes", "Refactor course routes", "class/course-portal", "2026-11-23T12:00:00Z", [
    {
      title: "Error discarded during load",
      severity: "low",
      category: "quality",
      file: "src/courses.ts",
      line: 45,
      explanation: "The handler hides a failed load behind an empty response.",
      suggestion: "Return an explicit error so callers can tell a failed load from an empty list.",
    },
    { ...testGap, file: "src/courses.ts", line: 29 },
  ]),
  sampleReview("cart", "Cover cart edge cases", "class/shop-api", "2026-11-21T12:00:00Z", []),
];

const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function load() {
  try {
    return storedReviews(localStorage.getItem(storageKey));
  } catch {
    return undefined;
  }
}

let imported = load();
let selected: Review | undefined;
const current = () => imported ?? sample;
const isSample = () => imported === undefined;
const query = get<HTMLInputElement>("query");
const severityFilter = get<HTMLSelectElement>("severity-filter");
const fileInput = get<HTMLInputElement>("report-file");
const repositoryInput = get<HTMLInputElement>("repository");
const importDialog = get<HTMLDialogElement>("import-dialog");
const reviewDialog = get<HTMLDialogElement>("review-dialog");
const importForm = get<HTMLFormElement>("import-form");
const importError = get("import-error");

function save(message: string) {
  const feedback = get("feedback");
  try {
    localStorage.setItem(storageKey, JSON.stringify(imported));
    feedback.textContent = message;
  } catch {
    feedback.textContent = `${message} Browser storage is unavailable or full. This change lasts until reload.`;
  }
  feedback.hidden = false;
  render();
}

function renderOverview() {
  const reviews = current();
  const { counts, total, repositories, recurring } = summarize(reviews);
  get("data-badge").textContent = isSample() ? "Sample data" : "Browser workspace";
  const metrics = [
    ["Reviews", reviews.length],
    ["Total findings", total],
    ["High or critical", counts.high + counts.critical],
    ["Repositories", repositories],
  ] as const;
  get("metrics").replaceChildren(
    ...metrics.map(([label, count], index) => {
      const card = element("div", undefined, `metric metric-${index}`);
      card.append(element("span", label), element("strong", String(count)));
      return card;
    }),
  );

  get("severity-chart").replaceChildren(
    ...severities.map((severity) => {
      const item = element("li", undefined, `severity-${severity}`);
      const track = element("span", undefined, "track");
      track.setAttribute("aria-hidden", "true");
      const fill = element("span", undefined, "fill");
      fill.style.width = `${total ? (counts[severity] / total) * 100 : 0}%`;
      track.append(fill);
      item.append(
        element("span", labels[severity]),
        track,
        element("strong", String(counts[severity])),
      );
      return item;
    }),
  );

  get("recurring").replaceChildren(
    ...(recurring.length
      ? recurring.map((issue) => {
          const item = element("li");
          item.append(
            element("span", issue.title),
            element("span", `${issue.reviews} reviews`, "badge"),
          );
          return item;
        })
      : [element("li", "No issue has appeared in multiple reviews yet.", "empty")]),
  );
}

function showReview(review: Review) {
  selected = review;
  get("detail-title").textContent = review.title;
  get("detail-meta").textContent =
    `${review.repository || "Unassigned repository"} · ${dateFormat.format(new Date(review.date))}`;
  const details = review.findings.map((finding) => {
    const card = element("article", undefined, `finding severity-${finding.severity}`);
    card.append(
      element("span", labels[finding.severity], "finding-severity"),
      element("h3", finding.title),
      element("code", `${finding.file}:${finding.line}`),
      element("p", finding.explanation),
      element("pre", finding.suggestion),
    );
    return card;
  });
  const empty =
    review.message ||
    (review.status === "ok"
      ? "This report contains no findings."
      : "The review did not produce findings.");
  get("detail-findings").replaceChildren(
    ...(details.length ? details : [element("p", empty, "empty")]),
  );
  get("remove-review").hidden = isSample();
  reviewDialog.showModal();
}

function renderHistory() {
  const search = query.value.trim().toLowerCase();
  const severity = severityFilter.value;
  const visible = current()
    .filter((review) => {
      const haystack = [
        review.title,
        review.repository,
        ...review.findings.map((finding) => `${finding.title} ${finding.file}`),
      ];
      return (
        (!search || haystack.some((value) => value.toLowerCase().includes(search))) &&
        (!severity || review.findings.some((finding) => finding.severity === severity))
      );
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  get("history-count").textContent = `${visible.length} of ${current().length} reviews`;
  const rows = visible.map((review) => {
    const row = element("tr");
    const title = element("td");
    const open = element("button", review.title, "review-link");
    open.type = "button";
    open.addEventListener("click", () => showReview(review));
    title.append(open);
    row.append(
      title,
      element("td", review.repository || "Unassigned"),
      element("td", review.status === "ok" ? String(review.findings.length) : "Skipped"),
      element("td", dateFormat.format(new Date(review.date))),
    );
    return row;
  });
  if (!rows.length) {
    const row = element("tr");
    const cell = element(
      "td",
      current().length
        ? "No reviews match these filters."
        : "Import a report to start your review history.",
      "empty",
    );
    cell.colSpan = 4;
    row.append(cell);
    rows.push(row);
  }
  get("review-rows").replaceChildren(...rows);
}

function render() {
  renderOverview();
  renderHistory();
}

get("open-import").addEventListener("click", () => {
  importError.hidden = true;
  importForm.reset();
  importDialog.showModal();
});

async function importReport() {
  const file = fileInput.files?.[0];
  if (!file) return;
  const submit = importForm.querySelector<HTMLButtonElement>("button[type=submit]");
  if (submit) submit.disabled = true;
  importError.hidden = true;
  try {
    if (file.size > maxReportBytes) throw new Error("Choose a report under 2 MB.");
    const review = parseReport(await file.text(), {
      id: crypto.randomUUID(),
      title: file.name.replace(/\.json$/i, "") || "Untitled report",
      repository: repositoryInput.value.trim(),
      date: new Date().toISOString(),
    });
    imported = [review, ...(imported ?? [])];
    query.value = "";
    severityFilter.value = "";
    importDialog.close();
    save(`Imported ${review.title}.`);
  } catch (error) {
    importError.textContent =
      error instanceof Error ? error.message : "The report could not be read.";
    importError.hidden = false;
  } finally {
    if (submit) submit.disabled = false;
  }
}

importForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void importReport();
});
get("remove-review").addEventListener("click", () => {
  if (!selected || !imported) return;
  imported = imported.filter((review) => review.id !== selected?.id);
  reviewDialog.close();
  save("Report removed from this browser workspace.");
  get("open-import").focus();
});
for (const dialog of [importDialog, reviewDialog]) {
  dialog.querySelector("[data-close]")?.addEventListener("click", () => dialog.close());
}
query.addEventListener("input", renderHistory);
severityFilter.addEventListener("change", renderHistory);

function updateNavigation() {
  const target = location.hash === "#reviews" ? "#reviews" : "#overview";
  for (const link of document.querySelectorAll(".nav-link")) {
    const active = link.getAttribute("href") === target;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  }
  const crumb = document.querySelector(".breadcrumb strong");
  if (crumb) crumb.textContent = target === "#reviews" ? "Review history" : "Overview";
}
window.addEventListener("hashchange", updateNavigation);
updateNavigation();
render();
