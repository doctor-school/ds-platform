---
---

Prepare unmodified Zitadel core and hosted Login 4.17.3 together across dev,
staging, CI and production configuration. Carry the existing private IPv4 HTTP
SMS adapter deny-list setting into production configuration while retaining
metadata, link-local and IPv6 restrictions, and document IdP database recovery.

This empty-package release record covers unversioned infrastructure images; it
bumps no workspace package. Hosted Login authentication-method and OTP text changes
remain subject to owner render approval. Preparation does not deploy the images;
real SMS delivery, exact-release recovery assets and production authorization
remain gated by #2166.
