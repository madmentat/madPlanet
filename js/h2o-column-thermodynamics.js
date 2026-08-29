/* ============ 0.5.60 hotfix: vertically integrated H2O saturation ============ */
/*
   h2o-advection originally compared precipitable-water mass against p_sat/g.
   That denominator is the mass of a column that is saturated everywhere at
   the *surface* temperature.  A real troposphere cools with height, so water
   vapour falls off far faster than total air density.  Using p_sat/g directly
   therefore made an Earth-like warm cell read RH~0.2 while cloud/fog gates
   were calibrated as ordinary meteorological RH (0.6..1.0).

   Clausius-Clapeyron gives a cheap vertical scale estimate:

       d ln(e_s) / dz ~= -L_v * Gamma / (R_v T^2)
       H_v ~= R_v T^2 / (L_v Gamma)
       column_sat ~= rho_v(0) H_v
                  ~= (p_sat/g) * g T / (L_v Gamma)

   This keeps the fixed-tick hot path O(1) per cell, but represents the falling
   temperature of the column instead of pretending that the whole atmosphere
   stays at surface T.  Warm/moist atmospheres use a smaller effective lapse
   rate, approaching a moist adiabat.
*/

const H2O_COLUMN_THERMO_MODEL=2;
const H2O_COLUMN_LV_273_J_KG=2.501e6;
const H2O_COLUMN_LV_SLOPE_J_KG_K=2360.0;
const H2O_COLUMN_DRY_LAPSE_K_M=0.0065;
const H2O_COLUMN_MOIST_LAPSE_K_M=0.0036;
const H2O_COLUMN_TARGET_RH_COOL=0.68;
const H2O_COLUMN_TARGET_RH_HOT=0.86;

function h2oColumnClamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0));}
function h2oColumnSmooth(a,b,x){
  if(a===b)return x>=b?1:0;
  const t=h2oColumnClamp((x-a)/(b-a),0,1);return t*t*(3-2*t);
}
function h2oColumnLatentHeat(T){
  T=h2oColumnClamp(T,180,647);
  return h2oColumnClamp(H2O_COLUMN_LV_273_J_KG-H2O_COLUMN_LV_SLOPE_J_KG_K*(T-273.15),1.65e6,2.75e6);
}
function h2oColumnLapseKPerM(T){
  const hot=h2oColumnSmooth(300,360,T);
  return H2O_COLUMN_DRY_LAPSE_K_M+(H2O_COLUMN_MOIST_LAPSE_K_M-H2O_COLUMN_DRY_LAPSE_K_M)*hot;
}
function h2oColumnFactorFromGravity(T,gMS2){
  T=h2oColumnClamp(T,180,647);gMS2=h2oColumnClamp(gMS2,0.05,200);
  const f=gMS2*T/(h2oColumnLatentHeat(T)*h2oColumnLapseKPerM(T));
  return h2oColumnClamp(f,0.10,0.58);
}
function h2oColumnSaturationFactor(T,climate){
  const g=(typeof h2oGravityMS2==='function')?h2oGravityMS2(climate):9.80665;
  return h2oColumnFactorFromGravity(T,g);
}
function h2oColumnDesiredRH(T){
  const hot=h2oColumnSmooth(305,365,T);
  return H2O_COLUMN_TARGET_RH_COOL+(H2O_COLUMN_TARGET_RH_HOT-H2O_COLUMN_TARGET_RH_COOL)*hot;
}

const h2oSaturationColumnKgM2BeforeVerticalProfile=h2oSaturationColumnKgM2;
h2oSaturationColumnKgM2=function(T,climate){
  const slab=Math.max(0,h2oSaturationColumnKgM2BeforeVerticalProfile(T,climate));
  return slab*h2oColumnSaturationFactor(T,climate);
};

/* Keep the slow one-box equilibrium reservoir consistent with the same
   definition of RH.  Previously its 0.25*p_sat rule was an implicit attempt
   to account for the vertical profile, while the local saturation denominator
   did not.  Now both use one explicit profile factor. */
if(typeof waterEquilibriumVaporInventory==='function'){
  waterEquilibriumVaporInventory=function(totalEow,T){
    totalEow=Math.max(0,Number(totalEow)||0);T=Number(T)||288.15;
    const pSat=(typeof waterSaturationPressureBar==='function')?Math.max(0,waterSaturationPressureBar(T)):0;
    const gEarth=(typeof atmosphereGravityEarth==='function')?Math.max(0.05,atmosphereGravityEarth()):1;
    const gMS2=9.80665*gEarth;
    const profile=h2oColumnFactorFromGravity(T,gMS2);
    const targetRH=h2oColumnDesiredRH(T);
    const pBar=pSat*profile*targetRH;
    const atmBar=(typeof EARTH_ATM_BAR!=='undefined')?EARTH_ATM_BAR:1.01325;
    const inv=pBar/(gEarth*atmBar);
    const cap=totalEow*(typeof WATER_EOW_TO_ATM_INV!=='undefined'?WATER_EOW_TO_ATM_INV:261.3);
    return Math.max(0,Math.min(cap,inv));
  };

  /* URL v6 stores total water, not atmospheric H2O.  Recompute the derived
     vapour reservoir immediately so an old page load does not spend minutes
     relaxing from the obsolete 0.25*p_sat equilibrium. */
  if(typeof settleWaterEquilibriumImmediate==='function'){
    try{settleWaterEquilibriumImmediate(2);}catch(e){}
  }
}
