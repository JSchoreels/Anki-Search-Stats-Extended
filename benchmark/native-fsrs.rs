// Read-only oracle. Run against the fsrs-rs revision pinned by the installed Anki build.
use fsrs::{FSRS, FSRSItem, FSRSReview, MemoryState};
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{self, Read};

#[derive(Deserialize)]
struct Review { delta: f32, rating: u32 }
#[derive(Deserialize)]
struct Case {
    weights: Vec<f32>,
    interval: Option<f32>,
    factor: Option<f32>,
    retention: Option<f32>,
    reviews: Vec<Review>,
    elapsed: f32,
    state: Option<[f32; 3]>,
}

// The encoded-FSRS correction is Anki's scale_state_to_interval algorithm.
fn scale(fsrs: &FSRS, shape: MemoryState, interval: f32, retention: f32) -> MemoryState {
    let ratio = shape.stability_fast / shape.stability;
    let at = |x: f64| {
        let stability = (x.exp() as f32).clamp(0.0001, 36500.0);
        MemoryState { stability, stability_fast: (stability * ratio).clamp(0.0001, 36500.0), ..shape }
    };
    let target = (interval.clamp(0.0001, 36500.0) as f64).ln();
    let err = |x| (fsrs.interval_at_retrievability(at(x), retention).max(f32::MIN_POSITIVE) as f64).ln() - target;
    let (mut low, mut high) = ((0.0001_f64).ln(), (36500_f64).ln());
    let mut x = (shape.stability.clamp(0.0001, 36500.0) as f64).ln();
    let mut error = err(x);
    let mut previous: Option<(f64, f64)> = None;
    for _ in 0..64 {
        if !error.is_finite() || error.abs() <= 1e-5 { break; }
        if error < 0.0 { low = x; } else { high = x; }
        let mut next = match previous {
            Some((px, pe)) if error != pe => x - error * (x - px) / (error - pe),
            _ => x - error,
        };
        if !(next > low && next < high) { next = (low + high) * 0.5; }
        previous = Some((x, error)); x = next; error = err(x);
    }
    if error.is_finite() { at(x) } else { shape }
}

fn state_json(state: MemoryState) -> Value {
    json!({"stability":state.stability, "difficulty":state.difficulty, "stabilityFast":state.stability_fast})
}
fn main() {
    let mut input = String::new(); io::stdin().read_to_string(&mut input).unwrap();
    let cases: Vec<Case> = serde_json::from_str(&input).unwrap();
    let outputs: Vec<Value> = cases.into_iter().map(|case| {
        let fsrs = FSRS::new(&case.weights).unwrap();
        let starting = case.interval.map(|interval| {
            let factor = case.factor.unwrap_or(2500.0);
            let ease = if factor == 0.0 { 2.5 } else { factor / 1000.0 };
            let retention = case.retention.unwrap_or(0.9);
            let mut state = fsrs.memory_state_from_sm2(ease, interval.max(1.0), retention).unwrap();
            if ease <= 1.1 { state.difficulty = (ease - 0.1) * 9.0 + 1.0; state = scale(&fsrs, state, interval.max(1.0), retention); }
            state
        });
        let state = case.state.map(|s| MemoryState {stability:s[0], stability_fast:s[1], difficulty:s[2]}).unwrap_or_else(|| fsrs.memory_state(FSRSItem { reviews: case.reviews.into_iter().map(|r| FSRSReview {rating:r.rating, delta_t:r.delta}).collect() }, starting).unwrap());
        json!({"starting":starting.map(state_json), "state":state_json(state), "r":fsrs.current_retrievability(state, case.elapsed), "s90":fsrs.interval_at_retrievability(state, 0.9)})
    }).collect();
    println!("{}", serde_json::to_string(&outputs).unwrap());
}
