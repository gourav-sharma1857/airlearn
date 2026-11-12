/** Site-wide settings. Branding comes from brand.config.json; the rest from .env (see README). */
import brand from "../brand.config.json";

export const APP_NAME: string = brand.name;
export const APP_TAGLINE: string = brand.tagline;
export const APP_LOGO: string = brand.logo;
export const FORMSPREE_ID: string = import.meta.env.VITE_FORMSPREE_ID || "";
export const FEEDBACK_URL: string = import.meta.env.VITE_FEEDBACK_URL || "";
export const ANALYTICS_ENDPOINT: string =
  import.meta.env.VITE_ANALYTICS_ENDPOINT || "";
/** Absolute URL of the site root, used by the worker to load its files. */
export const BASE_URL: string = new URL(import.meta.env.BASE_URL, location.href)
  .href;
