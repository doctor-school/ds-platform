import type { Metadata } from "next";

import { AcademyHomeView } from "./academy-home-view";

export const metadata: Metadata = {
  title: "Academy home demo — Doctor.School",
  description:
    "Статичная демонстрация утверждённой главной страницы Academy без данных и отправки форм.",
};

export default function AcademyHomePage() {
  return <AcademyHomeView />;
}
