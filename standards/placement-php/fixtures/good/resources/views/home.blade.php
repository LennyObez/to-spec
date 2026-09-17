<h1>{{ $title }}</h1>
<a href="{{ route('home') }}">home</a>
@foreach ($items as $item)
  <li>{{ $item }}</li>
@endforeach
