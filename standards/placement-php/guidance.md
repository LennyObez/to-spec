# Logic out of the view

## Why

A view is easier to read, to change and to trust when it is about what a page shows, not about
how the data was fetched. PHP embedded in a file that is not a PHP file, or a database query, a
configuration read or a raw request superglobal sitting in a view, ties the page to the
application's inner workings: the query cannot be tested apart from the markup, the configuration
is read where it cannot be swapped, and the request is trusted where it cannot be validated.
Moving that work into the application, and handing the view only the data it renders, keeps each
concern where it can be found and changed on its own.

## Rejected alternative

Flagging every call in a view was considered and dropped. A view is meant to call the helpers
that turn data into markup: a route, an asset, a translation, an escaped value. Reporting those
would flag the view doing its job. So the standard names the shapes that are logic rather than
presentation, a database query, an env() read, a raw superglobal, and leaves the presentation
helpers alone. Which files are views is a path the archetype provides, so a project that keeps
its views elsewhere is read correctly rather than against one framework's convention.

## What to do

Run the query, read the configuration and validate the request in the application, then pass the
view the finished data. An embedded PHP tag in a markup file becomes a real template or a value
the page is given. A `DB::` call in a view becomes a variable the controller filled. The view is
left with what it is for: turning data into the page a person sees.
