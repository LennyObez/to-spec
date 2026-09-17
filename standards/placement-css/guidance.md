# Styling out of the markup

## Why

A page is easier to read and to change when its structure and its presentation live apart.
Styling written into the markup, a `style` attribute on an element or a `<style>` element in
the page, ties the two together: a colour cannot be changed in one place, a rule cannot be
reused, and the markup grows unreadable. Moving the declarations into a stylesheet keeps each
concern where it can be found and changed on its own. This is the separation of content and
presentation the web platform is built around, applied to the one place it is most often lost.

## Rejected alternative

Flagging every occurrence with no exemptions was considered and dropped. Two shapes that look
like the violation are not: a `style` attribute inside an `<svg>` subtree, where the values
are part of the drawing rather than page styling, and a small `<style data-critical>` block,
the recognised way to place the handful of rules a first paint needs before the stylesheet
loads. Reporting those would train the reader to ignore the standard, which is worse than not
having it. The exemptions are declared and bounded: the critical block is allowed only while
it stays under a declared size, rather than left to judgement.

## What to do

Move the declarations into a stylesheet and reference it from the page. A `style` attribute
becomes a class; a `<style>` element becomes a linked stylesheet. Keep only what the two
exemptions cover: presentation on an `<svg>`, and a critical block small enough to be worth
placing there. Component files that legitimately co-locate their styling, such as single-file
components and email templates, are outside this standard by their paths, not by an exception
written into the markup.
