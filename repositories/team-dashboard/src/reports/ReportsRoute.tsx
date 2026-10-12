import { BoundaryState } from '../components/BoundaryState';
/** Reports have no local export endpoint or fabricated downloadable data. */
export function ReportsUnavailable() { return <BoundaryState state={{ status: 'unavailable' }} />; }
