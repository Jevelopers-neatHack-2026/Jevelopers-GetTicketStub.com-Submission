import {
	nmToPrivateMillimetres,
	privateMillimetresToNm,
} from "@jevelopers/shared-contracts/production-operations";
import { checked, requireCandidate } from "./canonical-values.js";
export function mm(value: string): number {
	const exact = checked(
		nmToPrivateMillimetres(value, "2000000000"),
		"INCOMPATIBLE_TEMPLATE",
	);
	const number = Number(exact);
	requireCandidate(
		checked(privateMillimetresToNm(number.toFixed(6), "2000000000")) === value,
		"INCOMPATIBLE_TEMPLATE",
		"template",
	);
	return number;
}
export function nm(value: number): string {
	return checked(privateMillimetresToNm(value.toFixed(6), "2000000000"));
}
