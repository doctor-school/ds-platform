export declare const INTERNAL_API_PREFIX: "/v1/internal";
export declare const BFF_API_REWRITE_SOURCE: string;
export declare function bffApiRewrite(apiOrigin: string): {
  source: string;
  destination: string;
};
