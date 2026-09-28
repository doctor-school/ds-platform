---
"@ds/admin": minor
---

The congress roster screen gets the registrar's desk entry (044 EARS-35, #2382):
«Добавить участника» opens a side panel beside the roster (the roster stays
visible and usable on a wide screen; a full screen on a phone) with the site
form's fields (фамилия, имя, отчество — optional, email, телефон, место работы)
and the tick «Согласие на обработку персональных данных получено на бумаге».
«Специальность» is searched in the closed book; «Населённый пункт» is searched in
the same directory as the congress site — a pick fills the region and shows it
under the field, and the «Регион» field appears only for a place not in the list.
An accepted entry closes the panel, names the participant and shows the new row;
an email already registered for the event keeps the panel open and links to that
participant's row; without the tick nothing is sent. A grant withdrawn since the
page loaded replaces the page with the «нет прав» message; a failed rights check
asks to try again with the typed values kept. The roster search can be seeded
from the address (`?q=`).
