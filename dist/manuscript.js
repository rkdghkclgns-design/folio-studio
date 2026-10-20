/** Remove only the exact legacy heading template from reading/export copies.
 * The editable manuscript and JSON backup remain untouched.
 */
export function withoutPlaceholderHeadings(value = '') {
  let fence = null;
  return String(value ?? '').replace(/\r\n?/g, '\n').split('\n').map(line => {
    if (fence) {
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})[\t ]*$/);
      if (closing && closing[1][0] === fence.marker && closing[1].length >= fence.length) fence = null;
      return line;
    }
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (opening && (opening[1][0] !== '`' || !opening[2].includes('`'))) {
      fence = {marker: opening[1][0], length: opening[1].length};
      return line;
    }
    return /^ {0,3}##[\t ]+소제목[\t ]*$/.test(line) ? '' : line;
  }).join('\n');
}
