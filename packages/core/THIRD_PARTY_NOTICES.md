# Third-party code attribution

## GamepadMotionHelpers — Julian "Jibb" Smart

The sensor-fusion runtime in [`src/sensor-fusion.js`](./src/sensor-fusion.js)
— gyro + accelerometer fusion, gravity tracking, and the continuous
bias-calibration pipelines (stillness calibration and in-motion "sensor
fusion" calibration) — is derived from
[**JibbSmart/GamepadMotionHelpers**](https://github.com/JibbSmart/GamepadMotionHelpers)
by Julian "Jibb" Smart, distributed under the MIT License.

The algorithms were ported from C++ to JavaScript and adapted for the WebHID
runtime, but the core math and tuning approach are Jibb's. The accompanying
[**GyroWiki**](http://gyrowiki.jibbsmart.com/) — in particular the
"Finding Gravity with Sensor Fusion" article — was indispensable in
understanding and implementing this code. Huge thanks to Jibb for both the
reference implementation and the writing that makes gyro input approachable.

The upstream MIT license is reproduced verbatim below as required by its
"include this copyright and permission notice in all copies or substantial
portions" clause.

---

MIT License

Copyright (c) 2020-2023 Julian "Jibb" Smart

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
