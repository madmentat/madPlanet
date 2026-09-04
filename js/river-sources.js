/* madPlanet 0.5.151 - river source filtering
   Filters river headwaters before visual network creation.
*/
(function(root){
'use strict';

function RiverSourceFilter(options){
    options = options || {};
    this.coastalBuffer = options.coastalBuffer ?? 2;
    this.minAccumulation = options.minAccumulation ?? 3;
    this.minSlope = options.minSlope ?? 0;
}

RiverSourceFilter.prototype.isValidSource = function(cell, data){
    if(!data) return false;
    if(data.ocean && data.ocean[cell]) return false;
    if((data.accumulation?.[cell] ?? 0) < this.minAccumulation) return false;
    if((data.coastalDistance?.[cell] ?? 999) < this.coastalBuffer) return false;
    if((data.slope?.[cell] ?? 0) < this.minSlope) return false;
    return true;
};

root.RiverSourceFilter = RiverSourceFilter;
})(typeof globalThis !== 'undefined' ? globalThis : window);
