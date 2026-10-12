import { StudioStart } from "@/customer/start/StudioStart";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className="desk-surface">
      {/* PLACEHOLDER HERO: replaced by the landing page. It only holds the place so <StudioStart /> has
          something above it; the landing page owns the real hero and places <StudioStart /> under it. */}
      <header className={styles.hero}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.logo} src="/brand/lockup-horizontal.svg" alt="TicketStub" />
        <h1 className={styles.headline}>Turn your ticket into a stub worth keeping.</h1>
        <p className={styles.lede}>Paste your event link and we print the night as a keepsake.</p>
      </header>
      <StudioStart />
    </main>
  );
}
