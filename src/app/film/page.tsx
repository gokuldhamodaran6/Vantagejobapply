import type { Metadata } from "next";
import { Film } from "./film";

// The stage the product film is recorded from. Not linked anywhere and not indexed.
export const metadata: Metadata = { title: "Film", robots: { index: false, follow: false } };

export default function FilmPage() {
  return <Film />;
}
