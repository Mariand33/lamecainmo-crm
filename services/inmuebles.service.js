function sbToInm(row) {
  return {
    id: row.id,
    titulo: row.titulo,
    descripcion: row.descripcion,
    zona: row.zona,
    precio: row.precio,
    moneda: row.moneda,
    tipoOperacion: row.tipo_operacion,
    tipoPropiedad: row.tipo_propiedad,
    dormitorios: row.dormitorios,
    estadoPublicacion: row.estado_publicacion
  };
}

module.exports = {
  sbToInm
};