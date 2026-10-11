import type { Finish, Material } from "../types";
import { SourceMark } from "@/customer/desk/Desk";
import { HOLO_WORDS, STATUS_WORDS, TIER_SIZES, statusMark, variantFor } from "@/customer/pages/capabilities";
import styles from "./overlays.module.css";

/**
 * Renders the stub on its stock: card, art paper, or a frame with a mat. The finish lives on the stub itself (Foil).
 * This is a CSS picture of the stock, not a printer proof: anything not yet orderable carries a printer's mark under it.
 */
export function MaterialFrame({ material, finish, children }: { material: Material; finish: Finish; children: React.ReactNode }) {
  const v = variantFor(material, TIER_SIZES[material][0], finish);
  const mark = v ? statusMark(v.status) : null;
  const words = v ? (finish === "holo" ? HOLO_WORDS : STATUS_WORDS[v.status]) : "";
  return (
    <div className={`${styles.frame} ${styles[`frame_${material}`]}`} data-material={material} data-finish={finish} data-status={v?.status}>
      <div className={styles.frameInner}>{children}</div>
      {mark ? (
        <span className={styles.frameMark}>
          <SourceMark p={mark} />
          {words}
        </span>
      ) : null}
    </div>
  );
}
