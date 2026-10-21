// A package-kept storefront host config (#3170) is held to the host-config
// convention too: an exported helper is host behaviour, not config data.
export const DOCTOR_AUTH_FLOW = { api: { basePath: "/v1/auth" } };

export const hostHelper = () => DOCTOR_AUTH_FLOW.api.basePath;
