// Injected into the current tab together with vendor/readability/Readability.js (see background.js).
// Finds the article with Readability, on a copy so the page itself stays untouched.
// The value of the last expression is the result of scripting.executeScript.
(() => {
  // Japanese and Korean pack a lot into few characters; Readability's default (500)
  // would reject many short articles.
  const MIN_ARTICLE_LENGTH = 150;

  /* global Readability */
  const article = new Readability(document.cloneNode(true), { charThreshold: MIN_ARTICLE_LENGTH }).parse();
  if (!article?.content) return null;
  return {
    title: article.title || document.title,
    byline: article.byline || "",
    siteName: article.siteName || location.hostname,
    lang: article.lang || document.documentElement.lang || "",
    html: article.content,
    url: location.href,
  };
})();
