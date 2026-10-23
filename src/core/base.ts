export const siteUrl = (file: string) => new URL(import.meta.env.BASE_URL + file.replace(/^\.\//, ''), document.baseURI).href;
