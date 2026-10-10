export interface ValidatedUrl {
  readonly url: URL;
  readonly hostname: string;
  readonly port: number;
}

export declare function isPublicAddress(address: string): boolean;
export declare function sameAddress(left: string, right: string): boolean;
export declare function validateHostname(hostname: string): string;
export declare function parseAndValidateUrl(input: string): ValidatedUrl;
