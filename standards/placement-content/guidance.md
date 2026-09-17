# Content out of the shared layout

## Why

A layout is the structure every page shares: the header, the shell, the footer the pages fill
with their own content. Words placed in the layout itself, a paragraph, a list of sentences,
show on every page and cannot differ from one to the next, so the one place a page should speak
for itself has been decided once for all of them. Moving that content into the page, or into a
data file the page reads, lets each page say its own thing and leaves the layout the structure
it is meant to be. This standard reports rather than blocks: the line between a structural label
and content is a matter of degree, and the person is shown where it looks crossed rather than
stopped over it.

## Rejected alternative

Flagging any text in a layout was considered and dropped. A layout carries structural labels, a
navigation item, a copyright line, a button's word, and those are not content in the sense that
matters: they are part of the structure and they are short. So the standard counts words, once
the template expressions the page supplies are removed, and reports only an element that holds
more than a handful, in the elements that carry prose. Which files are layouts is a path the
archetype provides, so a project's own arrangement is read rather than one convention assumed.

## What to do

Move the content into the page that owns it, or into a data file the layout reads through a
template expression. Leave the layout its structure and its short labels. If a block of text
genuinely belongs on every page, a footer notice, it still reads better from a data file the
layout renders than hardcoded into the markup, where it cannot be changed in one place.
