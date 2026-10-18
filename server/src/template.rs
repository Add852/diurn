//! Port of src/lib/template.ts — $date("fmt") + {key.question/answer/asked/prompt}.

use std::collections::HashMap;

use chrono::{Datelike, NaiveDate, Timelike};

#[derive(Clone, Debug, Default)]
pub struct TemplateVar {
    pub question: String,
    pub answer: String,
    pub asked: bool,
    pub prompt: String,
}

const WEEKDAYS: [&str; 7] = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
];
const WEEKDAYS_SHORT: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];
const MONTHS_SHORT: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

fn pad2(n: u32) -> String {
    format!("{n:0>2}")
}

/// .NET-style subset: d/D/M/y/H/h/m/s/t runs, quoted literals, backslash escapes.
pub fn format_template_date(date: NaiveDate, format: &str) -> String {
    let (y, mo, day) = (date.year(), date.month0() as usize, date.day());
    let (h24, min, sec) = (0u32, 0u32, 0u32); // JS parses date-only as local midnight
    let weekday = date.weekday().num_days_from_sunday() as usize;
    let h12 = h24 % 12;
    let h12 = if h12 == 0 { 12 } else { h12 };

    let chars: Vec<char> = format.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '\\' && i + 1 < chars.len() {
            out.push(chars[i + 1]);
            i += 2;
            continue;
        }
        if c == '\'' {
            let mut j = i + 1;
            let mut lit = String::new();
            let mut closed = false;
            while j < chars.len() {
                if chars[j] == '\'' {
                    closed = true;
                    break;
                }
                lit.push(chars[j]);
                j += 1;
            }
            if closed {
                out.push_str(&lit);
                i = j + 1;
            } else {
                out.push(c);
                i += 1;
            }
            continue;
        }
        let mut run = 1;
        while run < 4 && i + run < chars.len() && chars[i + run] == c {
            run += 1;
        }
        match c {
            'd' | 'D' => match run {
                4 => out.push_str(WEEKDAYS[weekday]),
                3 => out.push_str(WEEKDAYS_SHORT[weekday]),
                2 => out.push_str(&pad2(day)),
                _ => out.push_str(&day.to_string()),
            },
            'M' => match run {
                4 => out.push_str(MONTHS[mo]),
                3 => out.push_str(MONTHS_SHORT[mo]),
                2 => out.push_str(&pad2(mo as u32 + 1)),
                _ => out.push_str(&(mo as u32 + 1).to_string()),
            },
            'y' => {
                if run == 2 {
                    out.push_str(&format!("{:0>2}", y % 100));
                } else {
                    out.push_str(&y.to_string());
                }
            }
            'H' => {
                if run == 2 {
                    out.push_str(&pad2(h24));
                } else {
                    out.push_str(&h24.to_string());
                }
            }
            'h' => {
                if run == 2 {
                    out.push_str(&pad2(h12));
                } else {
                    out.push_str(&h12.to_string());
                }
            }
            'm' => out.push_str(&pad2(min)),
            's' => out.push_str(&pad2(sec)),
            't' => {
                if run >= 2 {
                    out.push_str(if h24 < 12 { "AM" } else { "PM" });
                } else {
                    out.push_str(if h24 < 12 { "A" } else { "P" });
                }
            }
            _ => {
                for _ in 0..run {
                    out.push(c);
                }
            }
        }
        i += run;
    }
    out
}

/// Replaces `$date("fmt")` (double/single quotes or bare) with formatted date.
fn replace_date_tokens(s: &str, date: NaiveDate) -> String {
    let re = regex::Regex::new(r#"\$date\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)"#).unwrap();
    re.replace_all(s, |caps: &regex::Captures| {
        let fmt = caps
            .get(1)
            .or_else(|| caps.get(2))
            .or_else(|| caps.get(3))
            .map(|m| m.as_str())
            .unwrap_or("");
        format_template_date(date, fmt)
    })
    .into_owned()
}

pub fn render_template(
    template: &str,
    vars: &HashMap<String, TemplateVar>,
    date: NaiveDate,
) -> String {
    let mut result = replace_date_tokens(template, date);
    for (key, var) in vars {
        for (suffix, value) in [
            ("question", var.question.as_str()),
            ("answer", var.answer.as_str()),
            ("asked", if var.asked { "true" } else { "false" }),
            ("prompt", var.prompt.as_str()),
        ] {
            let token = format!("{{{key}.{suffix}}}");
            result = result.replace(&token, value);
        }
    }
    result
}

pub fn default_template() -> &'static str {
    "---\ndayOfWeek: $date(\"dddd\")\n---\n\n- What happened today?\n  - {Q1.answer}\n- How did I feel?\n  - {Q2.answer}\n- What's one small adjustment?\n  - {Q3.answer}"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars() -> HashMap<String, TemplateVar> {
        HashMap::from([(
            "Q1".to_string(),
            TemplateVar {
                question: "What happened?".into(),
                answer: "laundry".into(),
                asked: true,
                prompt: String::new(),
            },
        )])
    }

    #[test]
    fn date_tokens() {
        let d = NaiveDate::from_ymd_opt(2026, 10, 17).unwrap(); // Saturday
        assert_eq!(format_template_date(d, "dddd"), "Saturday");
        assert_eq!(format_template_date(d, "ddd"), "Sat");
        assert_eq!(format_template_date(d, "dd"), "17");
        assert_eq!(format_template_date(d, "d"), "17");
        assert_eq!(format_template_date(d, "MMMM yyyy"), "October 2026");
        assert_eq!(format_template_date(d, "MM/dd/yy"), "10/17/26");
        assert_eq!(format_template_date(d, r"\d"), "d");
        assert_eq!(format_template_date(d, "'day' d"), "day 17");
    }

    #[test]
    fn renders_answers_and_date() {
        let d = NaiveDate::from_ymd_opt(2026, 10, 17).unwrap();
        let out = render_template(
            "---\ndayOfWeek: $date(\"dddd\")\n---\n- Q: {Q1.question}\n  - {Q1.answer}\n  - {Q2.answer}",
            &vars(),
            d,
        );
        assert!(out.contains("dayOfWeek: Saturday"));
        assert!(out.contains("Q: What happened?"));
        assert!(out.contains("- laundry"));
        // unknown identifier stays literal
        assert!(out.contains("{Q2.answer}"));
    }

    #[test]
    fn default_template_renders() {
        let d = NaiveDate::from_ymd_opt(2026, 10, 17).unwrap();
        let out = render_template(default_template(), &vars(), d);
        assert!(out.starts_with("---\ndayOfWeek: Saturday"));
        assert!(out.contains("- laundry"));
    }
}
