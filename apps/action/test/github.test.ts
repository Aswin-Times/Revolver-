import { describe, expect, it } from "vitest";
import type { PrRef } from "../src/event.js";
import { marker, SUMMARY_MARKER } from "../src/fingerprint.js";
import { createGitHubApi } from "../src/github.js";

const pr: PrRef = {
  owner: "class",
  repo: "alice-shop",
  number: 7,
  baseSha: "aaa",
  headSha: "bbb",
  fromFork: false,
};

interface Call {
  method: string;
  path: string;
  body?: unknown;
}

/** A fake fetch: routes by "METHOD path" (query string ignored) and records every call. */
function fakeGitHub(
  routes: Record<
    string,
    (call: Call) => { status?: number; body: unknown; headers?: Record<string, string> }
  >,
) {
  const calls: Call[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const call: Call = {
      method: (init?.method ?? "GET").toUpperCase(),
      path:
        url.pathname +
        (url.searchParams.get("page") ? `?page=${url.searchParams.get("page")}` : ""),
      ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) as unknown } : {}),
    };
    calls.push(call);
    const route = routes[`${call.method} ${call.path}`];
    if (!route)
      return Promise.resolve(
        new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }),
      );
    const { status = 200, body, headers = {} } = route(call);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
      }),
    );
  };
  return { calls, api: createGitHubApi("test-token", { fetch }) };
}

const comment = (path: string, line: number) => ({
  path,
  line,
  side: "RIGHT" as const,
  body: `x ${marker("0123456789abcdef")}`,
});

describe("createGitHubApi", () => {
  it("lists the current anchors of marked review comments across pages", async () => {
    const { api } = fakeGitHub({
      "GET /repos/class/alice-shop/pulls/7/comments": () => ({
        body: [
          {
            body: `ours ${marker("aaaaaaaaaaaaaaaa")}`,
            path: "a.py",
            line: 9,
            start_line: 7,
            side: "RIGHT",
          },
          { body: "a human reply", path: "a.py", line: 9, side: "RIGHT" },
          {
            body: `outdated ${marker("cccccccccccccccc")}`,
            path: "a.py",
            line: null,
            original_line: 4,
            side: "RIGHT",
          },
        ],
        headers: {
          link: '<https://api.github.com/repos/class/alice-shop/pulls/7/comments?page=2>; rel="next"',
        },
      }),
      "GET /repos/class/alice-shop/pulls/7/comments?page=2": () => ({
        body: [
          { body: `ours ${marker("bbbbbbbbbbbbbbbb")}`, path: "b.py", line: 12, side: "RIGHT" },
        ],
      }),
    });
    expect(await api.listInlineComments(pr)).toEqual([
      { body: `ours ${marker("aaaaaaaaaaaaaaaa")}`, path: "a.py", line: 7 },
      { body: `ours ${marker("bbbbbbbbbbbbbbbb")}`, path: "b.py", line: 12 },
    ]);
  });

  it("posts all inline comments as one COMMENT review on the head commit", async () => {
    const { api, calls } = fakeGitHub({
      "POST /repos/class/alice-shop/pulls/7/reviews": () => ({ body: { id: 1 } }),
    });
    const result = await api.createReview(pr, "summary line", [
      comment("a.py", 3),
      { ...comment("b.py", 9), startLine: 7 },
    ]);
    expect(result).toEqual({ posted: 2, failed: 0 });
    expect(calls[0]?.body).toEqual({
      commit_id: "bbb",
      event: "COMMENT",
      body: "summary line",
      comments: [
        { path: "a.py", line: 3, side: "RIGHT", body: comment("a.py", 3).body },
        {
          path: "b.py",
          line: 9,
          side: "RIGHT",
          start_line: 7,
          start_side: "RIGHT",
          body: comment("b.py", 9).body,
        },
      ],
    });
  });

  it("falls back to one comment at a time when GitHub rejects the review, skipping only the bad one", async () => {
    const { api, calls } = fakeGitHub({
      "POST /repos/class/alice-shop/pulls/7/reviews": () => ({
        status: 422,
        body: { message: "Line could not be resolved" },
      }),
      "POST /repos/class/alice-shop/pulls/7/comments": (call) =>
        (call.body as { line: number }).line === 99
          ? { status: 422, body: { message: "Line could not be resolved" } }
          : { status: 201, body: { id: 2 } },
    });
    const result = await api.createReview(pr, "s", [
      comment("a.py", 3),
      comment("a.py", 99),
      comment("b.py", 4),
    ]);
    expect(result).toEqual({ posted: 2, failed: 1 });
    expect(
      calls
        .filter((c) => c.path.endsWith("/pulls/7/comments"))
        .map((c) => (c.body as { commit_id: string }).commit_id),
    ).toEqual(["bbb", "bbb", "bbb"]);
  });

  it("makes no request when there's nothing new to post", async () => {
    const { api, calls } = fakeGitHub({});
    expect(await api.createReview(pr, "s", [])).toEqual({ posted: 0, failed: 0 });
    expect(calls).toEqual([]);
  });

  it("creates the summary comment once, then updates it in place", async () => {
    const created = fakeGitHub({
      "GET /repos/class/alice-shop/issues/7/comments": () => ({
        body: [{ id: 5, body: "nice work!" }],
      }),
      "POST /repos/class/alice-shop/issues/7/comments": () => ({ status: 201, body: { id: 6 } }),
    });
    await created.api.upsertSummary(pr, `report ${SUMMARY_MARKER}`);
    expect(created.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /repos/class/alice-shop/issues/7/comments",
      "POST /repos/class/alice-shop/issues/7/comments",
    ]);

    const updated = fakeGitHub({
      "GET /repos/class/alice-shop/issues/7/comments": () => ({
        body: [{ id: 6, body: `old ${SUMMARY_MARKER}` }],
      }),
      "PATCH /repos/class/alice-shop/issues/comments/6": () => ({ body: { id: 6 } }),
    });
    await updated.api.upsertSummary(pr, `new ${SUMMARY_MARKER}`);
    expect(updated.calls.at(-1)).toEqual({
      method: "PATCH",
      path: "/repos/class/alice-shop/issues/comments/6",
      body: { body: `new ${SUMMARY_MARKER}` },
    });
  });
});
