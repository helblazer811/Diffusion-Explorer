export function downloadJSON(data, filename = 'data.json') {
    const jsonStr = JSON.stringify(data, null, 2); // pretty-print
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();

    URL.revokeObjectURL(url); // Clean up
}