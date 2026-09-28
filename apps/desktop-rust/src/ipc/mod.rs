pub mod protocol;

use std::io::{self, Read, Write};

/// Writes a length-prefixed frame to any writer (e.g. Named Pipe or Socket)
pub fn write_framed_message<W: Write>(writer: &mut W, data: &[u8]) -> io::Result<()> {
    let len = data.len() as u32;
    writer.write_all(&len.to_be_bytes())?;
    writer.write_all(data)?;
    writer.flush()?;
    Ok(())
}

/// Reads a length-prefixed frame from any reader
pub fn read_framed_message<R: Read>(reader: &mut R, max_size: usize) -> io::Result<Vec<u8>> {
    let mut len_bytes = [0u8; 4];
    reader.read_exact(&mut len_bytes)?;
    let len = u32::from_be_bytes(len_bytes) as usize;

    if len > max_size {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Frame length {} exceeds maximum allowed {}", len, max_size),
        ));
    }

    let mut buffer = vec![0u8; len];
    reader.read_exact(&mut buffer)?;
    Ok(buffer)
}
