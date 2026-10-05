// ABOUTME: Exercise summary for Suunto AirTemp: min / average / max air temperature (kelvin, shown in the user's unit) and humidity.
// ABOUTME: main.js evaluates it once from getSummaryOutputs. Names are tokens here: the watch build translates ext files, the simulator shows them raw.
function (mn, avg, mx, rh) {
  var f = 'Temperature_Fourdigits', r = [
    { id: 'n', name: '{{sMin}}', format: f, value: mn + 273.15 },
    { id: 'a', name: '{{sAvg}}', format: f, value: avg + 273.15 },
    { id: 'x', name: '{{sMax}}', format: f, value: mx + 273.15 }
  ];
  if (rh === rh) r.push({ id: 'h', name: '{{sRh}}', format: 'Percentage_Threedigits', value: rh });
  return r;
}
