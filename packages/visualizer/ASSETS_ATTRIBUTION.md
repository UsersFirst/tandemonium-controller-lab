# Third-party asset attribution

The GLB controller models under `assets/controllers/` (`dualsense.glb`,
`switch-pro.glb`, `xbox.glb`) are derived from 3D models in
[larfingshnew/3d-controller-overlay](https://github.com/larfingshnew/3d-controller-overlay),
which is distributed under the MIT License. The original models ship in that
repo as OBJ files; the GLBs here were produced from those OBJs (see the
`scripts/convert-controller.js` and `scripts/convert-dualsense.js` helpers in
the upstream Tandemonium repo for the conversion pipeline).

The upstream MIT license is reproduced verbatim below as required by its
"include this copyright and permission notice in all copies" clause.

---

MIT License

Copyright (c) 2024 Larf

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
