# trix — marketing kit

Ready-to-paste texts and images for the places that need the owner's own account. Everything
here describes shipped features only (see [docs/features.md](../docs/features.md)); keep it that
way when editing.

| File | Where it goes |
|---|---|
| [botfather.md](botfather.md) | Bot profile in Telegram (@BotFather) |
| [catalogs.md](catalogs.md) | Telegram bot / Mini App catalogs, GitHub topics and awesome lists |
| [img/](img/) | Bot avatar and BotFather description picture |

Images are rendered from HTML by [build-images.mjs](build-images.mjs) (needs Playwright), so they
can be regenerated after new screenshots land in `docs/img/`.

## Order (about half an hour, once)

1. **Bot profile (5 min).** Run `node scripts/setup-telegram.mjs <worker-url>` once after the next
   deploy: it now also sets the bot's description and short description (uk + en). Then in
   @BotFather set the avatar and the description picture (see botfather.md).
2. **Google (10 min).** Add the site to [Google Search Console](https://search.google.com/search-console)
   as a *URL-prefix* property `https://sanych44474.github.io/trix/`, verify with the HTML-tag
   method (paste the tag into `docs/index.html` `<head>`), then submit the sitemap
   `https://sanych44474.github.io/trix/sitemap.xml`. Optional: the same in
   [Bing Webmaster Tools](https://www.bing.com/webmasters) (it can import from Search Console).
3. **GitHub (5 min).** Add the repo topics and the website link from catalogs.md.
4. **Catalogs (15 min).** Submit to the catalogs in catalogs.md.

## robots.txt

The site is a GitHub Pages *project* site (`sanych44474.github.io/trix/`). Crawlers read
`robots.txt` only from the host root (`sanych44474.github.io/robots.txt`), which belongs to a
separate `sanych44474.github.io` repository — a `robots.txt` inside this repo would be ignored.
Nothing is blocked today, so none is needed; the sitemap is submitted through Search Console
instead (step 2). With a custom domain later, add `docs/robots.txt` with
`Sitemap: https://<domain>/sitemap.xml`.
