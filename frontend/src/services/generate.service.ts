import html2pdf from 'html2pdf.js'

export async function downloadReport(pptxUrl: string, fileName?: string): Promise<void> {
  const link = document.createElement('a')
  link.href = pptxUrl
  link.download = fileName || 'report.pptx'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

/**
 * Download HTML content as a PDF file.
 * Uses an iframe to properly render the HTML with all its styles,
 * then converts each slide to a PDF page.
 */
export async function downloadHtmlAsPdf(
  htmlUrl: string,
  fileName?: string
): Promise<void> {
  try {
    // Fetch the HTML content
    const response = await fetch(htmlUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch HTML: ${response.statusText}`)
    }
    const htmlContent = await response.text()

    // Create an iframe to render the HTML with proper styles
    const iframe = document.createElement('iframe')
    iframe.style.cssText = `
      position: fixed;
      left: -9999px;
      top: 0;
      width: 1100px;
      height: 800px;
      border: none;
    `
    document.body.appendChild(iframe)

    // Write the HTML content to the iframe
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
    if (!iframeDoc) {
      throw new Error('Could not access iframe document')
    }

    // Write full HTML to iframe
    iframeDoc.open()
    iframeDoc.write(htmlContent)
    iframeDoc.close()

    // Wait for content to render
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Find all slides in the iframe
    const slides = iframeDoc.querySelectorAll('.slide')

    if (slides.length === 0) {
      // No slides found, try to render the whole body
      const body = iframeDoc.body
      if (body) {
        const options = {
          margin: [5, 5, 5, 5] as [number, number, number, number],
          filename: fileName || 'flash-report.pdf',
          image: { type: 'jpeg' as const, quality: 0.95 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            allowTaint: true,
            logging: false,
            windowWidth: 1100,
          },
          jsPDF: {
            unit: 'mm' as const,
            format: 'a4' as const,
            orientation: 'landscape' as const,
          },
        }
        await html2pdf().set(options).from(body).save()
      }
    } else {
      // Create a container for all slides arranged vertically for PDF
      const pdfContainer = document.createElement('div')
      pdfContainer.style.cssText = `
        width: 960px;
        background: white;
      `

      // Clone each slide and add to container
      slides.forEach((slide, index) => {
        const slideClone = slide.cloneNode(true) as HTMLElement

        // Reset positioning for PDF layout
        slideClone.style.cssText = `
          width: 960px;
          height: 540px;
          position: relative;
          margin: 0 auto 20px auto;
          background: white;
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          page-break-after: always;
          page-break-inside: avoid;
        `

        // Add page break class for html2pdf
        if (index > 0) {
          slideClone.classList.add('html2pdf__page-break')
        }

        pdfContainer.appendChild(slideClone)
      })

      // Copy styles from iframe to our container
      const iframeStyles = iframeDoc.querySelectorAll('style')
      iframeStyles.forEach((style) => {
        const newStyle = document.createElement('style')
        newStyle.textContent = style.textContent
        pdfContainer.prepend(newStyle)
      })

      // Add container to DOM temporarily
      pdfContainer.style.position = 'absolute'
      pdfContainer.style.left = '-9999px'
      pdfContainer.style.top = '0'
      document.body.appendChild(pdfContainer)

      // Wait for styles to apply
      await new Promise((resolve) => setTimeout(resolve, 200))

      // Configure html2pdf for slide-based output
      const options = {
        margin: [5, 5, 5, 5] as [number, number, number, number],
        filename: fileName || 'flash-report.pdf',
        image: { type: 'jpeg' as const, quality: 0.95 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          logging: false,
          windowWidth: 1000,
        },
        jsPDF: {
          unit: 'mm' as const,
          format: [254, 143] as [number, number], // 16:9 ratio in mm (roughly slide proportions)
          orientation: 'landscape' as const,
        },
        pagebreak: {
          mode: ['css', 'legacy'] as ('css' | 'legacy')[],
          before: '.html2pdf__page-break',
        },
      }

      // Generate PDF
      await html2pdf().set(options).from(pdfContainer).save()

      // Clean up container
      document.body.removeChild(pdfContainer)
    }

    // Clean up iframe
    document.body.removeChild(iframe)
  } catch (error) {
    console.error('PDF generation failed:', error)
    throw error
  }
}
