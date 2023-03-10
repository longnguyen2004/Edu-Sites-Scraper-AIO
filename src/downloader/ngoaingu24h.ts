import got from "got";
import ora from "ora";
import pMap from "p-map";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";
import { sanitizePath } from "./helper/sanitizePath.js";

import type { Ora } from "ora";
import { BrowserContext, Page, ElementHandle } from "puppeteer";

export const website = "ngoaingu24h.vn";

export async function login(browser: BrowserContext, username: string, password: string)
{
    const page = await browser.newPage();
    await page.goto("https://ngoaingu24h.vn");
    await page.$eval("#modal-login-v1", el => {
        el.classList.remove("fade");
        el.classList.add("show");
    });
    await page.type("#account-input", username);
    await page.type("#password-input", password);
    await Promise.all([
        page.click(".btn-login-v1"),
        page.waitForNavigation()
    ]);
    let cookies: [string, string][] | null;
    if (page.url() === "https://ngoaingu24h.vn/tat-ca-khoa-hoc?category=my-course")
        cookies = (await page.cookies()).map(cookie => [cookie.name, cookie.value]);
    else
        cookies = null;
    await page.close();
    return cookies;
}

export async function logout(browser: BrowserContext)
{
    const page = await browser.newPage();
    await page.goto("https://ngoaingu24h.vn/tat-ca-khoa-hoc?category=my-course");
    // @ts-expect-error
    await page.evaluate(() => onLogout());
}

async function downloadExam(page: Page, spinner: Ora, output: string)
{
    const title = await page.$eval(".path-panel-style a.active", el => el.textContent!);
    const subdir = join(output, sanitizePath(title));
    await mkdir(subdir, { recursive: true }).catch(() => {});

    spinner.text = "Downloading documents...";
    const docsInfo = await page.$$eval(".document-item a.view", elems => elems.map(
        el => { return { name: el.textContent!, link: el.href } }
    ));
    await pMap(docsInfo, async ({ name, link }) => {
        const content = await got(link).buffer();
        await writeFile(join(subdir, name), content);
    }, { concurrency: 5 });

    await page.$eval("#preloader", el => el.remove());
    await page.waitForXPath("//button[contains(text(), 'Xem gi???i chi ti???t')]")
        .then(async (elem) => {
            await delay(1000);
            await (elem! as ElementHandle<Element>).click()
        });
    await page.waitForSelector(".game-content-panel");

    spinner.text = "Capturing questions...";
    let count = 0;

    await page.$eval("#header", el => el.remove());

    let questions: ElementHandle<Element>[] = [];
    for (const selector of [
        "div[id^='childQuestion-']",
        "div[id^='mainViewPanel-']"
    ])
    {
        questions = await page.$$(selector);
        if (questions.length) break;
    }
    const total = questions.length;
    for (const question of questions)
    {
        ++count;
        spinner.text = `Capturing questions ${count}/${total} (${(count * 100 / total).toFixed(0)}%)`;
        const name = await question.evaluate(
            el => (parseInt(el.id.split("-")[1]) + 1).toString() + ".png"
        );
        await question.screenshot({ path: join(subdir, name) })
    }
    spinner.succeed("Finished!");
}

export async function download(ctx: BrowserContext, _: never, link: string, output: string)
{
    const spinner = ora("Loading page...").start();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(link);
    if (await page.$("#loxogame"))
        await downloadExam(page, spinner, output);
    await page.close();
}
