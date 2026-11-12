import { expect, test, type Page } from "@playwright/test";

async function loginAsDemo(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Fill in" }).click();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Welcome back, Demo/ })).toBeVisible();
}

test("unauthenticated users are redirected to login", async ({ page }) => {
  await page.goto("/tests");
  await expect(page).toHaveURL(/\/login/);
});

test("registration validates input and signs the user in", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Name").fill("E2E User");
  await page.getByLabel("Email").fill(`e2e-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(/at least 8 characters/i).first()).toBeVisible();
  await page.getByLabel("Password").fill("Passw0rd!e2e");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("No activity yet")).toBeVisible(); // empty state for a brand-new account
});

test("dashboard shows metrics for the demo workspace", async ({ page }) => {
  await loginAsDemo(page);
  await expect(page.getByText("Total requests")).toBeVisible();
  await expect(page.getByRole("img", { name: /Requests per day/ })).toBeVisible();
  await expect(page.getByText("API performance by endpoint")).toBeVisible();
});

test("API client sends a request with environment variables", async ({ page }) => {
  await loginAsDemo(page);
  await page.getByRole("link", { name: "API Client" }).click();
  await page.getByLabel("Request URL").fill("{{baseUrl}}/posts/1");
  await expect(page.getByText("baseUrl").first()).toBeVisible();
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("response-meta")).toContainText("200");
  await expect(page.getByTestId("code-view")).toContainText('"id": 1');
});

test("SSRF attempts are blocked with a clear message", async ({ page }) => {
  await loginAsDemo(page);
  await page.goto("/workspace");
  await page.getByLabel("Request URL").fill("http://169.254.169.254/latest/meta-data/");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText(/blocked/i);
});

test("collections can be created and deleted", async ({ page }) => {
  await loginAsDemo(page);
  await page.goto("/collections");
  const name = `E2E Collection ${Date.now()}`;
  await page.getByRole("button", { name: "New collection" }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  const section = page.locator("section", { has: page.getByRole("heading", { name }) });
  await expect(section).toBeVisible();
  await section.getByRole("button", { name: "Delete collection" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("heading", { name })).toHaveCount(0);
});

test("AI-generated tests must be approved before running", async ({ page }) => {
  await loginAsDemo(page);
  await page.goto("/tests");
  await page.getByRole("button", { name: "New suite" }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill(`E2E Suite ${Date.now()}`);
  await page.getByRole("button", { name: "Create suite" }).click();
  await expect(page.getByRole("button", { name: "Run suite" })).toBeDisabled();

  await page.getByRole("button", { name: "Generate with AI" }).first().click();
  await page.getByRole("tab", { name: "Custom endpoint" }).click();
  await page.getByLabel("Endpoint URL").fill("https://jsonplaceholder.typicode.com/posts");
  await page.getByRole("button", { name: "Generate tests" }).click();
  await expect(page.getByText("Review generated tests")).toBeVisible();

  await page.getByRole("button", { name: /^Approve \d+/ }).click();
  await expect(page.getByText("Review generated tests")).toHaveCount(0);
  await page.getByRole("button", { name: "Run suite" }).click();
  await expect(page.getByRole("heading", { name: "Test run report" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Pass rate")).toBeVisible();
});
