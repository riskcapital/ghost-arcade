fn main() {
    let path = std::env::args().nth(1).expect("usage: validate_wgsl <file.wgsl>");
    let src = std::fs::read_to_string(&path).expect("read shader file");
    let module = match naga::front::wgsl::parse_str(&src) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("{}", e.emit_to_string(&src));
            std::process::exit(1);
        }
    };
    let mut validator = naga::valid::Validator::new(
        naga::valid::ValidationFlags::all(),
        naga::valid::Capabilities::all(),
    );
    if let Err(e) = validator.validate(&module) {
        eprintln!("validation error: {:?}", e);
        std::process::exit(1);
    }
    println!("WGSL OK");
}
