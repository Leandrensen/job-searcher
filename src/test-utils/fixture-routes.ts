const WWR = "https://weworkremotely.com/categories/";
const GOB_CATEGORIES = [
  "programming",
  "sysadmin-devops-qa",
  "mobile-developer",
  "data-science-analytics",
  "machine-learning-ai",
  "cybersecurity",
];

/**
 * Every URL the 9 adapters request on a first run, mapped to a recorded fixture.
 * Paged sources point at "last page" fixtures so a run never asks for page 2.
 */
export const ALL_SOURCE_ROUTES: Record<string, string> = {
  "https://remoteok.com/api": "remoteok/api.json",
  ...Object.fromEntries(
    [
      "remote-programming-jobs.rss",
      "remote-full-stack-programming-jobs.rss",
      "remote-back-end-programming-jobs.rss",
      "remote-front-end-programming-jobs.rss",
      "remote-devops-sysadmin-jobs.rss",
    ].map((feed) => [`${WWR}${feed}`, "weworkremotely/programming.rss"]),
  ),
  ...Object.fromEntries(
    GOB_CATEGORIES.map((cat) => [
      `https://www.getonbrd.com/api/v0/categories/${cat}/jobs?per_page=100&page=1&expand=%5B%22company%22%5D`,
      "getonboard/programming-last-page.json",
    ]),
  ),
  "https://remotive.com/api/remote-jobs": "remotive/api.json",
  "https://himalayas.app/jobs/api?limit=20": "himalayas/last-page.json",
  "https://jobicy.com/api/v2/remote-jobs?count=100&industry=dev": "jobicy/api.json",
  "https://www.workingnomads.com/api/exposed_jobs/": "workingnomads/api.json",
  "https://www.arbeitnow.com/api/job-board-api?page=1": "arbeitnow/last-page.json",
  "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10": "hn-hiring/search.json",
  "https://hn.algolia.com/api/v1/items/50338728": "hn-hiring/item.json",
};
