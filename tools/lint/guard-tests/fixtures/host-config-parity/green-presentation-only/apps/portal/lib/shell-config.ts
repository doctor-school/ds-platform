// Fixture: the Academy's shell host values, built from its message catalog.
export function academyShellConfig(t: (key: string) => string) {
  return {
    host: "academy",
    logo: { alt: t("logoAlt"), href: "/webinars" },
    topbar: { text: t("topbar") },
    search: { placeholder: "Поиск по эфирам", action: "/events" },
    nav: [{ label: t("navBroadcasts"), href: "/webinars" }],
    footer: { navTitle: t("footerSections"), documents: [{ label: t("footerDocuments"), href: "/documents" }] },
    hiddenOnPaths: ["/login"],
  };
}
