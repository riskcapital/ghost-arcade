//! Small bounded tempo corrections; never seek a decoder to chase clock jitter.
pub fn phase_position(time: f64, lo: f64, span: f64, reverse: bool, bounce: bool) -> f64 {
    let position = (time - lo).clamp(0.0, span);
    if reverse { if bounce { 2.0 * span - position } else { span - position } }
    else { position }
}
pub fn phase_error(target: f64, actual: f64, cycle: f64) -> f64 {
    (target - actual + cycle / 2.0).rem_euclid(cycle) - cycle / 2.0
}
pub fn correction(error_seconds: f64, nominal_rate: f64) -> f64 {
    // A two-second settling horizon and a 4% ceiling avoid visible jumps.
    (1.0 + error_seconds / nominal_rate.abs().max(0.05) / 2.0).clamp(0.96, 1.04)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn seams_choose_the_short_route() {
        assert!((phase_error(0.01, 9.99, 10.0) - 0.02).abs() < 1e-9);
        assert!((phase_error(9.99, 0.01, 10.0) + 0.02).abs() < 1e-9);
        assert_eq!(phase_position(7.0, 2.0, 10.0, true, true), 15.0);
    }
    #[test]
    fn ten_minutes_of_clock_skew_and_tempo_changes_stay_locked() {
        let mut target = 0.0;
        let mut actual = -0.08;
        for step in 0..6000 {
            let rate = if step < 2000 { 1.0 } else if step < 4000 { 1.4 } else { 0.6 };
            let error = phase_error(target, actual, 10.0);
            let adjusted = rate * correction(error, rate);
            assert!((adjusted / rate - 1.0).abs() <= 0.0400001);
            actual += adjusted * 0.1 * 1.00002;
            target += rate * 0.1;
            if step > 100 { assert!(phase_error(target, actual, 10.0).abs() < 0.002); }
        }
    }
}
