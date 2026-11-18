// Employer profile for the healthcare work-hours provision (M10.4).
//
// LABOR CODE ART. 83, as amended. Health personnel in cities and municipalities with a population of
// at least one million, or in hospitals and clinics with a bed capacity of at least one hundred, work
// eight hours a day, five days a week — forty hours. If the employer requires a sixth day, that day
// carries an additional compensation of at least thirty percent of the regular wage.
//
// WHAT THIS FILE DOES
// It records what the demo actually knows about the employer and answers whether the provision
// applies. It does not assume that a hospital, or a clinic, or a healthcare worker automatically
// falls inside it: both the population test and the bed-capacity test are facts about the employer,
// and the demo has only one of them.
//
// The MediHeal demo is a 60-bed hospital and its city is not recorded, so applicability is
// UNDETERMINED. `sixthDayPremium()` refuses to price a sixth day until it is settled, which is the
// honest outcome: inventing a 30% premium for an employer that may not be covered would overpay, and
// omitting it for one that is covered would underpay.
(function () {
  var EMPLOYER = {
    name: 'MediHeal Hospital',
    // NOT RECORDED. A city name alone is not enough — the test is the population of the city or
    // municipality where the establishment sits, and that figure needs a source and a date.
    city: null,
    cityPopulation: null,
    cityPopulationSource: null,
    bedCapacity: 60,
    bedCapacitySource: 'Facility profile: a 60-bed private hospital.',
    employsHealthPersonnel: true
  };

  var POPULATION_THRESHOLD = 1000000;
  var BED_THRESHOLD = 100;

  function art83() {
    var missing = [];
    if (EMPLOYER.cityPopulation == null) missing.push('cityPopulation');
    if (EMPLOYER.bedCapacity == null) missing.push('bedCapacity');

    var byCity = EMPLOYER.cityPopulation != null && EMPLOYER.cityPopulation >= POPULATION_THRESHOLD;
    var byBeds = EMPLOYER.bedCapacity != null && EMPLOYER.bedCapacity >= BED_THRESHOLD;

    if (byCity || byBeds) {
      return {
        status: 'covered',
        basis: byCity ? 'city or municipality population' : 'hospital bed capacity',
        detail: byCity
          ? 'Population ' + EMPLOYER.cityPopulation.toLocaleString('en-PH') + ' meets the 1,000,000 threshold.'
          : 'Bed capacity ' + EMPLOYER.bedCapacity + ' meets the 100-bed threshold.',
        populationThreshold: POPULATION_THRESHOLD,
        bedThreshold: BED_THRESHOLD
      };
    }
    if (missing.length) {
      return {
        status: 'undetermined',
        missing: missing,
        detail: 'The provision applies to health personnel in a city or municipality of at least ' +
          '1,000,000 people, or in a hospital or clinic with at least 100 beds. ' +
          (EMPLOYER.bedCapacity != null ? 'This establishment has ' + EMPLOYER.bedCapacity + ' beds, below the threshold. ' : '') +
          'The population of the city or municipality is not recorded, so applicability cannot be decided.',
        populationThreshold: POPULATION_THRESHOLD,
        bedThreshold: BED_THRESHOLD
      };
    }
    return {
      status: 'not-covered',
      detail: 'Neither the population test nor the bed-capacity test is met.',
      populationThreshold: POPULATION_THRESHOLD,
      bedThreshold: BED_THRESHOLD
    };
  }

  // The additional compensation for a required sixth day, at least 30% of the regular wage.
  // Returns ok:false unless the provision is established as applicable.
  function sixthDayPremium(employee, opts) {
    opts = opts || {};
    var a = art83();
    if (a.status !== 'covered') {
      return {
        ok: false,
        error: 'Article 83 applicability is ' + a.status + '. ' + a.detail,
        applicability: a
      };
    }
    var hours = opts.hours == null ? 8 : Number(opts.hours);
    if (!(hours > 0)) return { ok: false, error: 'A sixth day needs positive hours.' };
    var hourly = HIS.payrollCalc.hourlyRateOf(employee);
    var amount = Math.round(hourly * 0.30 * hours * 100) / 100;
    return {
      ok: true, hours: hours, hourly: Math.round(hourly * 100) / 100,
      rate: 0.30, amount: amount,
      note: 'Additional 30% for the sixth day. If that day is also the designated rest day, the ' +
        'rest-day premium applies instead — do not add both.'
    };
  }

  function set(field, value, source) {
    if (!(field in EMPLOYER)) return { ok: false, error: 'Unknown employer field: ' + field };
    EMPLOYER[field] = value;
    if (field === 'cityPopulation' && source) EMPLOYER.cityPopulationSource = source;
    return { ok: true, employer: profile() };
  }

  function profile() {
    return {
      name: EMPLOYER.name, city: EMPLOYER.city, cityPopulation: EMPLOYER.cityPopulation,
      cityPopulationSource: EMPLOYER.cityPopulationSource,
      bedCapacity: EMPLOYER.bedCapacity, bedCapacitySource: EMPLOYER.bedCapacitySource,
      employsHealthPersonnel: EMPLOYER.employsHealthPersonnel
    };
  }

  HIS.employer = {
    PROFILE: EMPLOYER,
    POPULATION_THRESHOLD: POPULATION_THRESHOLD, BED_THRESHOLD: BED_THRESHOLD,
    profile: profile, set: set, art83: art83, sixthDayPremium: sixthDayPremium
  };
})();
