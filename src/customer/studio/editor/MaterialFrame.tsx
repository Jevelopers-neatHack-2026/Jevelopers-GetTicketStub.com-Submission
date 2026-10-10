import type { Finish, Material } from "../types";
import styles from "./overlays.module.css";

/** Renders the stub on its stock: card, art paper, or a frame with a mat. The finish lives on the stub itself (Foil). */
export function MaterialFrame({ material, finish, children }: { material: Material; finish: Finish; children: React.ReactNode }) {
  return (
    <div className={`${styles.frame} ${styles[`frame_${material}`]}`} data-material={material} data-finish={finish}>
      <div className={styles.frameInner}>{children}</div>
    </div>
  );
}
