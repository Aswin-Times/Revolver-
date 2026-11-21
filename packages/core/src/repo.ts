/**
 * How core reads the post-change version of a repository without knowing about git or
 * GitHub. The CLI reads the working tree, the Action reads its checkout, the GitHub App
 * fetches contents through the API, and evals read fixture files.
 */
export interface RepoContext {
  /** Head-revision contents of a repo-relative path, or undefined if unavailable. */
  readFile(path: string): Promise<string | undefined>;
  /** Every file path at the head revision. Optional; improves missing-test messages. */
  listFiles?(): Promise<string[]>;
}
